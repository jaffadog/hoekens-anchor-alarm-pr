/*
 * Copyright 2016 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const geolib = require('geolib')

const subscriberPeriod = 1000

module.exports = function(app) {
  var plugin = {};

  plugin.id = "hoekens-anchor-alarm"
  plugin.name = "Hoeken's Anchor Alarm"
  plugin.description = "Put your Raspberry Pi on anchor watch."

  plugin.schema = {
    title: "Hoeken's Anchor Alarm",
    type: "object",
    required: [
      "radius",
      "active",
    ],
    properties: {
      state: {
        title: "Alarm Serverity",
        description: "Anchor alarm notification level",
        type: "string",
        default: "emergency",
        "enum": ["alert", "warn", "alarm", "emergency"]
      }, 
      enableEngineCheck: {
        type: 'boolean',
        title: 'Engine check before alarm',
        description: "Check propulsion.* to see if the engines are on before sending alarm notification.",
        default: true
      },
      noPositionAlarmTime: {
        type: "number",
        title: "Send a notification if no position is received for the given number of seconds",
        default: 10
      },
      on: {
        type: 'boolean',
        title: 'Alarm On',
        description: "Used for saving state in case of SignalK restart.",
        default: false
      },
      radius: {
        type: "number",
        title: "Alarm Radius (m)",
        description: "Used for saving state in case of SignalK restart.",
        default: 60
      },
      position: {
        type: "object",
        title: "Anchor Position",
        description: "Used for saving state in case of SignalK restart.",
        properties: {
          latitude: {
            title: "Latitude",
            type: "number"
          },
          longitude: {
            title: "Longitude",
            type: "number"
          }
        }
      },
    }
  }

  var alarm_sent = false
  let onStop = []
  var state
  var configuration
  var lastPosition
  var lastTrueHeading
//  var positionInterval
//  var saveOptionsTimer
  
  plugin.start = function(props) {
    configuration = props
    try {
      var isOn = configuration['on']
      var position = configuration['position']
      var radius = configuration['radius']
      if ( typeof isOn != 'undefined'
           && isOn
           && typeof position != 'undefined'
           && typeof radius != 'undefined' )
      {
        startWatchingPosition()
      }

      if ( app.registerActionHandler ) {
        app.registerActionHandler('vessels.self',
                                  `navigation.anchor.position`,
                                  putPosition)

        app.registerActionHandler('vessels.self',
                                  `navigation.anchor.maxRadius`,
                                  putRadius)

        // app.registerActionHandler('vessels.self',
        //                           `navigation.anchor.rodeLength`,
        //                           putRodeLength)
      }

      app.handleMessage(plugin.id, {
        updates: [
          {
            meta: [
              {
                path: 'navigation.anchor.bearingTrue',
                value: { units: 'rad' }
              },
              {
                path: 'navigation.anchor.apparentBearing',
                value: { units: 'rad' }
              }
            ]
          }
        ]
      })
      
    } catch (e) {
      plugin.started = false
      app.error("error: " + e);
      console.error(e.stack)
      return e
    }
  }

  // TODO: this appears to be old unsupported code?  why timeout?
  // function savePluginOptions() {
  //   if ( app.savePluginOptionsSync ) {
  //     app.savePluginOptionsSync(configuration)
  //   } else if ( !saveOptionsTimer ) {
  //     saveOptionsTimer = setTimeout(() => {
  //       app.debug('saving options..')
  //       saveOptionsTimer = undefined
  //       app.savePluginOptions(configuration, err => {
  //         if ( err ) {
  //           app.error(err)
  //         }
  //       })
  //     }, 1000)
  //   }
  // }

  function savePluginOptions() {
    app.debug('saving options..')
    app.savePluginOptions(configuration, err => {
      if ( err ) {
        app.error(err)
      }
    })
  }

  function putRadius(context, path, value, cb) {
    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [
            {
              path: "navigation.anchor.maxRadius",
              value: value
            }
          ]
        }
      ]
    })

    configuration["radius"] = value
    if ( configuration["position"] ) {
      configuration["on"] = true
      startWatchingPosition()
    }

    try {
      savePluginOptions()
      return {state: 'SUCCESS'}
    } catch { err } {
      app.error(err)
      return {state: 'FAILURE', message: err.message}
    }
  }

  function putPosition(context, path, value, cb) {
    try {
      if ( value == null ) {
        raiseAnchor()
      } else {
        var delta = getAnchorDelta(app, null, value, null, configuration["radius"], true, null);
        app.handleMessage(plugin.id, delta)
        
        configuration["position"] = { "latitude": value.latitude, "longitude": value.longitude }
        
        configuration["radius"] = value.radius
        if ( configuration["radius"] ) {
          configuration["on"] = true
          startWatchingPosition()
        }

        savePluginOptions()
      }
      return {state: 'SUCCESS'}
    } catch { err } {
      app.error(err)
      return {state: 'FAILURE', message: err.message}
    }
  }   
    
  plugin.stop = function() {
    if ( alarm_sent )
    {
      var delta = getAnchorAlarmDelta(app, "normal")
      app.handleMessage(plugin.id, delta)
    }
    alarm_sent = false
    var delta = getAnchorDelta(app, null, null, null, null, false, null)
    app.handleMessage(plugin.id, delta)

    stopWatchingPosition()
    
    //OLD CODE?
    // if ( positionInterval ) {
    //   clearInterval(positionInterval)
    //   positionInterval = null
    // }
  }

  function stopWatchingPosition()
  {
    onStop.forEach(f => f())
    onStop = []
  }

  function startWatchingPosition()
  {
    if ( onStop.length > 0 )
      return

    app.subscriptionmanager.subscribe(
      {
        context: 'vessels.self',
        subscribe: [
          {
            path: 'navigation.position',
            period: subscriberPeriod
          },
          {
            path: 'navigation.headingTrue',
            period: subscriberPeriod
          }
        ]
      },
      onStop,
      (err) => {
        app.error(err)
        app.setProviderError(err)
      },
      (delta) => {
        let position, trueHeading
        
        if ( delta.updates ) {
          delta.updates.forEach(update => {
            if ( update.values ) {
              update.values.forEach(vp => {
                if ( vp.path === 'navigation.position' ) {
                  position = vp.value
                } else if ( vp.path === 'navigation.headingTrue' ) {
                  trueHeading = vp.value
                }
              })
            }
          })
        }

        if ( position ) {
                    
          var state
          lastPosition = position
          state = checkPosition(app, plugin, configuration.radius,
                                position, configuration.position)
          var was_sent = alarm_sent
          alarm_sent = state
          if (was_sent && !state)
          {
            //clear it
            app.debug("clear_it")
            var delta = getAnchorAlarmDelta(app, "normal")
            app.handleMessage(plugin.id, delta)
          }

          sendAnchorAlarm(state, app, plugin)
        }

        if ( typeof trueHeading !== 'undefined' || position ) {
          if ( typeof trueHeading  !== 'undefined' ) {
            lastTrueHeading = trueHeading
          }
          computeAnchorApparentBearing(lastPosition, configuration.position, lastTrueHeading)
        }
      }
    )
  }

  function raiseAnchor() {
    app.debug("raise anchor")
    
    var delta = getAnchorDelta(app, null, null, null, null, false, null)
    app.handleMessage(plugin.id, delta)
    
    if ( alarm_sent )
    {
      var delta = getAnchorAlarmDelta(app, "normal")
      app.handleMessage(plugin.id, delta)
    }
    alarm_sent = false
    
    delete configuration["position"]
    delete configuration["radius"]
    configuration["on"] = false

    stopWatchingPosition()
    
    //OLD CODE?
    // if ( positionInterval ) {
    //   clearInterval(positionInterval)
    //   positionInterval = null
    // }

    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [ {
            path: 'navigation.anchor.apparentBearing',
            value: null
          }, {
            path: 'navigation.anchor.bearingTrue',
            value: null
          }
                  ]
        }]})

    savePluginOptions()
  }


  plugin.registerWithRouter = function(router) {
    router.post("/dropAnchor", (req, res) => {
      var vesselPosition = app.getSelfPath('navigation.position')
      if ( vesselPosition && vesselPosition.value )
        vesselPosition = vesselPosition.value
      
      if ( typeof vesselPosition == 'undefined' )
      {
        app.debug("no position available")
        res.status(403)
        res.json({
          statusCode: 403,
          state: 'FAILED',
          message: "no position available"
        })
      }
      else
      {

        let position = computeBowLocation(vesselPosition,
                                      app.getSelfPath('navigation.headingTrue.value'))
        
        app.debug("set anchor position to: " + position.latitude + " " + position.longitude)
        var radius = req.body['radius']
        if ( typeof radius == 'undefined' )
          radius = null
        var delta = getAnchorDelta(app, vesselPosition, position, 0, radius, true, null);
        app.handleMessage(plugin.id, delta)

        app.debug("anchor delta: " + JSON.stringify(delta))
        
        configuration["position"] = { "latitude": position.latitude,
                                      "longitude": position.longitude }
        configuration["radius"] = radius
        configuration["on"] = true

        var depth = app.getSelfPath('environment.depth.belowSurface.value')
        if ( depth ) {
          configuration.position.altitude = depth * -1;
        }

        startWatchingPosition()

        try {
          savePluginOptions()
          res.json({
            statusCode: 200,
            state: 'COMPLETED'
          })
        } catch ( err ) {
          app.error(err)
          res.status(500)
          res.json({
            statusCode: 500,
            state: 'FAILED',
            message: "can't save config"
          })
        }
      }
    })
    
    router.post("/setRadius", (req, res) => {
      let position = app.getSelfPath('navigation.position')
      if ( position.value )
        position = position.value
      if ( typeof position == 'undefined' )
      {
        app.debug("no position available")
        res.status(403)
        res.json({
          statusCode: 403,
          state: 'FAILED',
          message: "no position available"
        })
      }
      else
      {
        var radius = req.body['radius']
        if ( typeof radius == 'undefined' )
        {
          app.debug("config: %o", configuration)
          radius = calc_distance(configuration.position.latitude,
                                 configuration.position.longitude,
                                 position.latitude,
                                 position.longitude)
          
          app.debug("calc_distance: " + radius)
        }

        app.debug("set anchor radius: " + radius)

        var delta = getAnchorDelta(app, position, configuration.position, null,
                                   radius, false, null);
        app.handleMessage(plugin.id, delta)
        
        configuration["radius"] = radius

        try {
          savePluginOptions()
          res.json({
            statusCode: 200,
            state: 'COMPLETED'
          })
        } catch ( err ) {
          app.error(err)
          res.status(500)
          res.json({
            statusCode: 500,
            state: 'FAILED',
            message: "can't save config"
          })
        }
      }
    })

    router.post("/raiseAnchor", (req, res) => {
      try {
        raiseAnchor()
        res.json({
          statusCode: 200,
          state: 'COMPLETED'
        })
      } catch ( err ) {
        app.error(err)
        res.status(500)
        res.json({
          statusCode: 500,
          state: 'FAILED',
          message: "can't save config"
        })
      }
    })

    router.post("/setAnchorPosition", (req, res) => {
      var old_pos = app.getSelfPath('navigation.anchor.position.value')
      var depth

      if ( old_pos && old_pos.altitude ) {
        depth = old_pos.altitude
      }
      
      var position = req.body['position']

      var maxRadius = app.getSelfPath('navigation.anchor.maxRadius.value')

      var delta = getAnchorDelta(app, null, position, null,
                                 maxRadius, false, depth);

      app.debug("setAnchorPosition: " + JSON.stringify(delta))
      app.handleMessage(plugin.id, delta)

      configuration["position"] = {
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: depth
      }

      try {
        savePluginOptions()
        res.json({
          statusCode: 200,
          state: 'COMPLETED'
        })
      } catch ( err ) {
        app.error(err)
        res.status(500)
        res.json({
          statusCode: 500,
          state: 'FAILED',
          message: "can't save config"
        })
      }
    });
  }

  function getAnchorDelta(app, vesselPosition, position,
                          currentRadius, maxRadius, isSet, depth)
  {
    var values

    if ( vesselPosition == null )
    {
      vesselPosition = app.getSelfPath('navigation.position.value')
    }

    if ( position )
    {
      var position = {
        "latitude": position.latitude,
        "longitude": position.longitude
      };
      
      if ( isSet )
      {
        if ( !depth )
        {
          depth = app.getSelfPath('environment.depth.belowSurface.value')
        }
        app.debug("depth: %o", depth)
        if ( typeof depth != 'undefined' )
        {
          position.altitude = -1 * depth
        }
      }
      else
      {
        var depth = configuration.position.altitude
            //_.get(app.signalk.self,
	//	          'navigation.anchor.position.altitude')
        if ( typeof depth != 'undefined' )
        {
          position.altitude = depth
        }
      }  
      
      values = [
        {
          path: "navigation.anchor.position",
          value: position
        }
        /*
          {
          path: 'navigation.anchor.state',
          value: 'on'
          }
        */
      ]

      let bowPosition = computeBowLocation(vesselPosition, app.getSelfPath('navigation.headingTrue.value'))
      let bearing  = degsToRad(geolib.getRhumbLineBearing(bowPosition, position))
      let distanceFromBow = calc_distance(bowPosition.latitude,
                                          bowPosition.longitude,
                                          position.latitude,
                                          position.longitude)

      values.push(        {
        path: 'navigation.anchor.distanceFromBow',
        value: distanceFromBow
      })
      
      values.push(        {
        path: 'navigation.anchor.bearingTrue',
        value: bearing
      })

      if ( currentRadius != null ) {
        values.push(        {
          path: 'navigation.anchor.currentRadius',
          value: currentRadius
        })
      }

      if ( maxRadius != null ) {
        values.push({
          path: 'navigation.anchor.maxRadius',
          value: maxRadius
        })
        var zones = [
          {
            state: "normal",
            lower: 0,
            upper: maxRadius
          },
          {
            state: configuration.state,
            lower: maxRadius
          }
        ];

        values.push({
          path: 'navigation.anchor.meta',
          value: {
            zones: zones
          }
        })
      }
    }
    else
    {
      values = [
        {
          path: 'navigation.anchor.position',
          value: null //{ latitude: null, longitude: null}
        },
        {
          path: 'navigation.anchor.currentRadius',
          value: null
        },
        {
          path: 'navigation.anchor.maxRadius',
          value: null
        },
        // {
        //   path: 'navigation.anchor.distanceFromBow',
        //   value: null
        // }
        // {
        // path: 'navigation.anchor.state',
        // value: 'off'
        // }
      ]
    }

    var delta = {
      "updates": [
        {
          "values": values
        }
      ]
    }

    //app.debug("anchor delta: " + util.inspect(delta, {showHidden: false, depth: 6}))
    return delta;
  }

  function checkPosition(app, plugin, radius, position, anchor_position) {
    //app.debug("in checkPosition: " + position.latitude + ',' + anchor_position.latitude)

    var meters = calc_distance(position.latitude, position.longitude,
                               anchor_position.latitude, anchor_position.longitude);
    
    app.debug("distance: " + meters + ", radius: " + radius);
    
    var delta = getAnchorDelta(app, position, anchor_position, meters, radius, false)
    app.handleMessage(plugin.id, delta)

    if ( radius != null ) {
      if ( meters > radius ) {
        //TODO: add our engine check here.
        state = configuration.state
      }

      if ( state )
        return state
    }
  
    return null
  }

  function computeBowLocation(position, heading) {
    if ( typeof heading != 'undefined' )
    {
      var gps_dist = app.getSelfPath("sensors.gps.fromBow.value");
      //app.debug("gps_dist: " + gps_dist)
      if ( typeof gps_dist != 'undefined' )
      {
        position = calc_position_from(app, position, heading, gps_dist)
        //app.debug("adjusted position by " + gps_dist)
      }
    }
    return position
  }

  function computeAnchorApparentBearing(vesselPosition,
                                        anchorPosition,
                                        trueHeading)
  {
    if (vesselPosition && anchorPosition && typeof trueHeading  !== 'undefined' ) {
      let bowPosition = computeBowLocation(vesselPosition, trueHeading)
      let bearing = degsToRad(geolib.getRhumbLineBearing(bowPosition,
                                                         anchorPosition))


      /* there's got to be a better way?? */
      let offset
      if ( bearing > Math.PI ) {
        offset = Math.PI*2 - bearing
      } else {
        offset = -bearing
      }

      let zeroed = trueHeading + offset
      let apparent
      if ( zeroed < Math.PI ) {
        apparent = -zeroed
      } else {
        apparent = zeroed
        if ( apparent > Math.PI ) {
          apparent = (Math.PI*2 - apparent)
        }
      }

      //app.debug("apparent " + radsToDeg(trueHeading) + ", " + radsToDeg(bearing) + ", " + apparent + ", " + radsToDeg(apparent))
      
      app.handleMessage(plugin.id, {
        updates: [
          {
            values: [ {
              path: 'navigation.anchor.apparentBearing',
              value: apparent
            } ]
          }
        ]
      })
    }
  }

  function sendAnchorAlarm(state, app, plugin, msg)
  {
    if ( state )
    {
      var delta = getAnchorAlarmDelta(app, state, msg)
      app.debug("send alarm: %j", delta)
      app.handleMessage(plugin.id, delta)
    }
  }

  return plugin;
}

function calc_distance(lat1,lon1,lat2,lon2) {
  //app.debug("calc_distance: " + lat1 + ", " + lon1 + ", " + lat2 + ", " + lon2)
  var R = 6371000; // Radius of the earth in m
  var dLat = degsToRad(lat2-lat1);  // deg2rad below
  var dLon = degsToRad(lon2-lon1); 
  var a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(degsToRad(lat1)) * Math.cos(degsToRad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ; 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  var d = R * c; // Distance in m
  return d;
}

function calc_position_from(app, position, heading, distance)
{
  var dist = (distance / 1000) / 1.852  //m to nm
  dist /= (180*60/Math.PI)  // in radians

  //app.debug("dist: " + dist)
  
  heading = (Math.PI*2)-heading
  
  var lat = Math.asin(Math.sin(degsToRad(position.latitude)) * Math.cos(dist) + Math.cos(degsToRad(position.latitude)) * Math.sin(dist) * Math.cos(heading))
  
  var dlon = Math.atan2(Math.sin(heading) * Math.sin(dist) * Math.cos(degsToRad(position.latitude)), Math.cos(dist) - Math.sin(degsToRad(position.latitude)) * Math.sin(lat))
  
  var lon = mod(degsToRad(position.longitude) - dlon + Math.PI, 2 * Math.PI) - Math.PI
  
  return { "latitude": radsToDeg(lat),
           "longitude": radsToDeg(lon) }
}
  
function getAnchorAlarmDelta(app, state, msg)
{
  if ( ! msg ) {
    msg = "Anchor Alarm - " + state.charAt(0).toUpperCase() + state.slice(1)
  }
  let method = [ "visual", "sound" ]
  const existing = app.getSelfPath('notifications.navigation.anchor.value')
  console.log(existing);
  app.debug('existing %j', existing)
  if ( existing && existing.state !== 'normal' ) {
    method = existing.method
  }
  var delta = {
      "updates": [
        {
          "values": [
            {
              "path": "notifications.navigation.anchor",
              "value": {
                "state": state,
                method,
                "message": msg,
              }
            }]
        }
      ]
  }
  return delta;
}

function radsToDeg(radians) {
  return radians * 180 / Math.PI
}

function degsToRad(degrees) {
  return degrees * (Math.PI/180.0);
}

function mod(x,y){
  return x-y*Math.floor(x/y)
}

function mpsToKn(mps) {
  return 1.9438444924574 * mps
}