# hoekens-anchor-alarm

This is a fork of the venerable https://github.com/sbender9/signalk-anchoralarm-plugin by Scott Bender.

I wanted a simple, web-only anchor alarm with my own personal UI style and some features that may be controversial, like automatic alarm cancelling if your engines are running.  If you want to use an external app or API, you are probably better off using the old plugin.

Some of the changes I've made:

* Kept the old style UI with anchor placed at map center.
* Added historical tracks from the https://github.com/SignalK/tracks via the.
  * I recommend setting this to a resolution of 1000ms and 86400 points to keep.  This gives you high resolution data for the last 24 hours.  You've got plenty of memory, so might as well use it.
* Added colors to the historical tracks.  Green = new, fading to Red = old.
* Added a line to show distance and bearing to anchor.
* Added wind speed / angle
* Removed distance to anchor from anchor radius UI
* Added a check to prevent anchor alarm from firing when propulsion.*.rpm is > 0
  * I always forget to turn the anchor alarm off and it always goes off when I'm leaving the anchorage.
  * If you're truly dragging and you have your motor(s) on, then you know about it and you don't need another annoyance when you're dealing with it.


# Web App

Point your Web Browser to http://[signalk-server-ip-address]:[port-number]/hoekens-anchor-alarm/

# Attribution

<a href="https://www.flaticon.com/free-icons/anchor" title="anchor icons">Anchor icons created by Freepik - Flaticon</a>