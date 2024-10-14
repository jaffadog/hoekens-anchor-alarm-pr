# TODO: 

* add check to propulsion.* before calling calling alarm.
* also show other vessels and their path history within filterRadius.
* figure out why noPositionAlarmTime is not getting used.
* update plugin status when anchored, idle, or dragging.
* pass the anchor alarm state to the web client.
* raise anchor on initial page load has a small bug with anchor location.

# DONE:

* update leaflet and jquery
* display high resolution history with paths plugin.
* add hotline to differentiate old vs new path: https://github.com/iosphere/Leaflet.hotline
* add line and distance to anchor to UI.
* added bearing to anchor to UI.
* added wind speed / angle
* boat going back inside radius should clear alarm
* anchor alarm should include distance in message.

* remove / cleanup extra stuff in the module
  * rodeLength
  * manual setting
  * warning levels - should be a binary trigger
  * config settings
  * altitude in dropAnchor calls