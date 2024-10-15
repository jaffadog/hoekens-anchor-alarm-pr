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

module.exports = function (app) {
  var plugin = {};

  plugin.id = "hoekens-anchor-alarm"
  plugin.name = "Hoeken's Anchor Alarm"
  plugin.description = "Fork of signalk-anchoralarm-plugin with upgraded UI, historical tracks, and lazy mode engine state awareness."

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

  let onStop = [];
  let alarm_state;
  let configuration;

  plugin.start = function (props) {

    app.setPluginStatus("Started");

    configuration = props
    try {
      var isOn = configuration['on']
      var position = configuration['position']
      var radius = configuration['radius']
      if (typeof isOn != 'undefined'
        && isOn
        && typeof position != 'undefined'
        && typeof radius != 'undefined') {
        startWatchingPosition()
      }

      if (app.registerActionHandler) {
        app.registerActionHandler('vessels.self',
          `navigation.anchor.position`,
          putPosition)

        app.registerActionHandler('vessels.self',
          `navigation.anchor.maxRadius`,
          putRadius)
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

      var delta = getAnchorAlarmDelta(app, "normal", "Anchor Alarm - Started")
      app.handleMessage(plugin.id, delta)
      alarm_state = "normal"

    } catch (e) {
      plugin.started = false
      app.error("error: " + e);
      console.error(e.stack)
      return e
    }
  }

  function savePluginOptions() {
    //app.debug('saving options..')
    app.savePluginOptions(configuration, err => {
      if (err) {
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
    if (configuration["position"]) {
      configuration["on"] = true
      startWatchingPosition()
    }

    try {
      savePluginOptions()
      return { state: 'SUCCESS' }
    } catch { err } {
      app.error(err)
      return { state: 'FAILURE', message: err.message }
    }
  }

  function putPosition(context, path, value, cb) {
    try {
      if (value == null) {
        raiseAnchor()
      } else {
        var delta = getAnchorDelta(app, null, value, null, configuration["radius"], true, null);
        app.handleMessage(plugin.id, delta)

        configuration["position"] = { "latitude": value.latitude, "longitude": value.longitude }

        configuration["radius"] = value.radius
        if (configuration["radius"]) {
          configuration["on"] = true
          startWatchingPosition()
        }

        savePluginOptions()
      }
      return { state: 'SUCCESS' }
    } catch { err } {
      app.error(err)
      return { state: 'FAILURE', message: err.message }
    }
  }

  plugin.stop = function () {
    if (alarm_state != "normal") {
      var delta = getAnchorAlarmDelta(app, "normal", "Anchor Alarm - Stopped")
      app.handleMessage(plugin.id, delta)
      alarm_state = "normal"
    }
    var delta = getAnchorDelta(app, null, null, null, null, false, null)
    app.handleMessage(plugin.id, delta)

    stopWatchingPosition()

    app.setPluginStatus("Stopped");
  }

  function stopWatchingPosition() {
    var delta = getAnchorAlarmDelta(app, "normal", "Anchor Alarm - Idle")
    app.handleMessage(plugin.id, delta)
    alarm_state = "normal"

    app.setPluginStatus("Idle");

    onStop.forEach(f => f())
    onStop = []
  }

  function startWatchingPosition() {
    if (onStop.length > 0)
      return

    var delta = getAnchorAlarmDelta(app, "normal", "Anchor Alarm - Watching")
    app.handleMessage(plugin.id, delta)
    alarm_state = "normal"

    app.setPluginStatus("Watching");

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

        if (delta.updates) {
          delta.updates.forEach(update => {
            if (update.values) {
              update.values.forEach(vp => {
                if (vp.path === 'navigation.position') {
                  position = vp.value
                } else if (vp.path === 'navigation.headingTrue') {
                  trueHeading = vp.value
                }
              })
            }
          })
        }

        if (position)
          checkPosition(app, plugin, configuration.radius, position, configuration.position);
      }
    )
  }

  function raiseAnchor() {
    app.debug("raise anchor")

    var delta = getAnchorDelta(app, null, null, null, null, false, null)
    app.handleMessage(plugin.id, delta)

    delete configuration["position"]
    delete configuration["radius"]
    configuration["on"] = false

    stopWatchingPosition()

    savePluginOptions()
  }

  plugin.registerWithRouter = function (router) {

    router.post("/dropAnchor", (req, res) => {
      var position = req.body['position']

      if (typeof position == 'undefined') {
        app.debug("no position supplied")
        res.status(403)
        res.json({
          statusCode: 403,
          state: 'FAILED',
          message: "no position supplied"
        })
      }
      else {
        app.debug("set anchor position to: " + position.latitude + " " + position.longitude)
        var radius = req.body['radius']
        if (typeof radius == 'undefined')
          radius = null
        var delta = getAnchorDelta(app, null, position, 0, radius, true);
        app.handleMessage(plugin.id, delta)

        //app.debug("anchor delta: " + JSON.stringify(delta))

        configuration["position"] = {
          "latitude": position.latitude,
          "longitude": position.longitude
        }
        configuration["radius"] = radius
        configuration["on"] = true

        startWatchingPosition()

        try {
          savePluginOptions()
          res.json({
            statusCode: 200,
            state: 'COMPLETED'
          })
        } catch (err) {
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
      if (position.value)
        position = position.value
      if (typeof position == 'undefined') {
        app.debug("no position supplied")
        res.status(403)
        res.json({
          statusCode: 403,
          state: 'FAILED',
          message: "no position supplied"
        })
      }
      else {
        var radius = req.body['radius']
        if (typeof radius == 'undefined') {
          app.debug("no position supplied")
          res.status(403)
          res.json({
            statusCode: 403,
            state: 'FAILED',
            message: "no position supplied"
          })
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
        } catch (err) {
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
      } catch (err) {
        app.error(err)
        res.status(500)
        res.json({
          statusCode: 500,
          state: 'FAILED',
          message: "can't save config"
        })
      }
    })
  }

  function getAnchorDelta(app, vesselPosition, position,
    currentRadius, maxRadius, isSet) {
    var values

    if (vesselPosition == null) {
      vesselPosition = app.getSelfPath('navigation.position.value')
    }

    if (position) {
      var position = {
        "latitude": parseFloat(position.latitude),
        "longitude": parseFloat(position.longitude)
      };

      values = [
        {
          path: "navigation.anchor.position",
          value: position
        },
        {
          path: 'navigation.anchor.state',
          value: 'on'
        }
      ]

      if (currentRadius != null) {
        values.push({
          path: 'navigation.anchor.currentRadius',
          value: currentRadius
        })
      }

      if (maxRadius != null) {
        maxRadius = parseFloat(maxRadius);
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
    else {
      values = [
        {
          path: 'navigation.anchor.position',
          value: null //{ latitude: null, longitude: null}
        },
        {
          path: 'navigation.anchor.state',
          value: 'off'
        },
        {
          path: 'navigation.anchor.currentRadius',
          value: null
        },
        {
          path: 'navigation.anchor.maxRadius',
          value: null
        }
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

    //app.debug("distance: " + meters + ", radius: " + radius);

    var delta = getAnchorDelta(app, position, anchor_position, meters, radius, false)
    app.handleMessage(plugin.id, delta)

    let new_state = "normal";
    let do_update = false;
    let message = "Anchor Alarm - OK";

    //compare our radius
    if (radius != null && meters > radius) {
      //okay, we're dragging.
      new_state = configuration.state;
      let meters_rounded = Math.round(meters);
      message = `Anchor Alarm - Dragging (${meters_rounded}m)`;

      //wait, do we have engines on?
      if (configuration.enableEngineCheck) {
        if (checkEngineState(app, plugin)) {
          app.debug("alarm disabled due to engines on: %j", delta)
          do_update = true;
          new_state = "normal";
          message = "Anchor Alarm - Disabled due to engines on.";

          raiseAnchor();

          app.setPluginStatus("Disabled due to engines on.");
        }
      }
    }

    if (new_state !== alarm_state || do_update) {
      var delta = getAnchorAlarmDelta(app, new_state, message)
      app.debug("alarm state change: %j", delta)
      app.handleMessage(plugin.id, delta)

      alarm_state = new_state;

      if (alarm_state == "normal")
        app.setPluginStatus("OK");
      else
        app.setPluginError("Dragging");
    }
  }

  return plugin;
}

function checkEngineState(app, plugin) {
  app.debug("in checkEngineState");

  propulsion = app.getSelfPath('propulsion');

  console.log(propulsion);

  if (typeof propulsion !== 'undefined') {
    const propulsionKeys = Object.keys(propulsion);

    for (let key of propulsionKeys) {
      if (propulsion[key] && propulsion[key].revolutions && propulsion[key].revolutions.value > 0)
        return true;
      if (propulsion[key] && propulsion[key].state && propulsion[key].state.value === 'started')
        return true;
    }
  }

  return false;
}

function calc_distance(lat1, lon1, lat2, lon2) {
  //app.debug("calc_distance: " + lat1 + ", " + lon1 + ", " + lat2 + ", " + lon2)
  var R = 6371000; // Radius of the earth in m
  var dLat = degsToRad(lat2 - lat1);  // deg2rad below
  var dLon = degsToRad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degsToRad(lat1)) * Math.cos(degsToRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
    ;
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in m
  return d;
}

function getAnchorAlarmDelta(app, state, msg) {
  if (!msg)
    msg = "Anchor Alarm - " + state.charAt(0).toUpperCase() + state.slice(1)

  let method = ["visual", "sound"]

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
  return degrees * (Math.PI / 180.0);
}

function mod(x, y) {
  return x - y * Math.floor(x / y)
}