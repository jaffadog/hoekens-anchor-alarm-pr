# TODO:

* also show other vessels and their path history within filterRadius.
* implement a no position watchdog.
* experiment with dragging the anchor, instead of the map

# DONE:

* update leaflet and jquery
* display high resolution history with paths plugin.
* add hotline to differentiate old vs new path: https://github.com/iosphere/Leaflet.hotline
* add line and distance to anchor to UI.
* added bearing to anchor to UI.
* added wind speed / angle
* boat going back inside radius should clear alarm
* anchor alarm should include distance in message.
* add check to propulsion.* before calling calling alarm.
* update plugin status when anchored, idle, or dragging.
* raise anchor on initial page load has a small bug with anchor location.
* load wind / depth data on first call
* web client tracks signalk state properly

* remove / cleanup extra stuff in the module
  * rodeLength
  * manual setting
  * warning levels - should be a binary trigger
  * config settings
  * altitude in dropAnchor calls