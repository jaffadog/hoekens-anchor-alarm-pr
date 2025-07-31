L.BoatMarker = L.Marker.extend({
  options: {
    zoomAnimation: false,
    beam: 0,              // metres beam (x-axis, left→right)
    loa: 0,              // metres length (y-axis, top→bottom)
    gpsOffset: { x: 0, y: 0 }, // metres from SVG top-left to antenna
    icon: '',             // path or URL to your SVG
    heading: 0               // initial rotation in degrees
  },

  initialize(latlng, options) {
    L.Util.setOptions(this, options);

    // console.log(`loa: ${options.loa} beam: ${options.beam} gpsOffset: ${options.gpsOffset.x}, ${options.gpsOffset.y}`);

    // Build a tiny DivIcon; we'll size it dynamically later
    const icon = L.divIcon({
      className: 'leaflet-boat-marker',
      html: `<img src="${this.options.icon}" style="width:100%; height:100%;" />`,
      iconSize: [1, 1],
      iconAnchor: [0, 0]
    });

    options.icon = icon;
    L.Marker.prototype.initialize.call(this, latlng, options);
  },

  onAdd(map) {
    L.Marker.prototype.onAdd.call(this, map);
    this._update();                     // initial sizing & rotation
    map.on('zoom viewreset', this._update, this);
  },

  onRemove(map) {
    map.off('zoom viewreset', this._update, this);
    L.Marker.prototype.onRemove.call(this, map);
  },

  // Public method to change heading on the fly
  setHeading(deg) {
    this.options.heading = deg;

    // // grab Leaflet’s own translate3d(...) string…
    // const t = this._icon.style[L.DomUtil.TRANSFORM];

    // // …and tack on your rotate
    // this._icon.style[L.DomUtil.TRANSFORM] = `${t} rotate(${this.options.heading}deg)`;

    // now rotate just the image
    const img = this._icon.querySelector('img');
    if (img)
      img.style.transform = `rotate(${deg}deg)`;

    return this;
  },

  // Recompute size, anchor and rotation
  _update() {
    if (!this._map || !this._icon) return;

    const map = this._map;
    const ll = this.getLatLng();
    const p0 = map.latLngToLayerPoint(ll);

    // Approx metres-per-degree at this latitude
    const cosLat = Math.cos(ll.lat * Math.PI / 180);
    const mPerDegLon = 111320 * cosLat;
    const mPerDegLat = 110574;

    // Compute px width & height from metre dims
    const pW = map.latLngToLayerPoint([ll.lat, ll.lng + this.options.beam / mPerDegLon]);
    const pH = map.latLngToLayerPoint([ll.lat + this.options.loa / mPerDegLat, ll.lng]);
    const wPx = Math.abs(pW.x - p0.x);
    const hPx = Math.abs(pH.y - p0.y);

    // Compute the offset in px for the GPS antenna
    const oX = (this.options.gpsOffset.x / this.options.beam) * wPx;
    const oY = (this.options.gpsOffset.y / this.options.loa) * hPx;

    // Apply to the icon’s container
    Object.assign(this._icon.style, {
      width: `${wPx}px`,
      height: `${hPx}px`,
      marginLeft: `${-oX}px`,     // shift so the GPS point aligns at (0,0)
      marginTop: `${-oY}px`,
    });

    const img = this._icon.querySelector('img');
    img.style.transformOrigin = `${oX}px ${oY}px`;

    this.setHeading(this.options.heading);
  }
});