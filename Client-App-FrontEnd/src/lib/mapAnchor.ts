import L from "leaflet";

export function pinContainerPoint(size: L.Point, bottomPadding: number) {
  return L.point(size.x / 2, Math.max(48, (size.y - bottomPadding) / 2));
}

export function latLngAtPin(map: L.Map, bottomPadding: number) {
  return map.containerPointToLatLng(pinContainerPoint(map.getSize(), bottomPadding));
}

export function setViewAtPin(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  bottomPadding: number,
  animate = false,
) {
  const size = map.getSize();
  if (size.x === 0 || size.y === 0) {
    map.setView([lat, lng], zoom, { animate: false });
    return;
  }
  const target = pinContainerPoint(size, bottomPadding);
  const projected = map.project(L.latLng(lat, lng), zoom);
  const center = map.unproject(projected.subtract(target).add(size.divideBy(2)), zoom);
  map.setView(center, zoom, { animate });
}
