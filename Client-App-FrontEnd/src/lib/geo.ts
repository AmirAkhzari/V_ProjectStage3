import { CITIES } from "@/data/cities";
import type { City } from "@/types";

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const earth = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isCityPlace(city: City) {
  return !city.main.startsWith("استان");
}

export function nearestCity(lat: number, lng: number): City {
  const places = CITIES.filter(isCityPlace);
  return places.reduce((best, city) => (
    distanceKm(lat, lng, city.lat, city.lng) < distanceKm(lat, lng, best.lat, best.lng) ? city : best
  ));
}

export function pinLabel(lat: number, lng: number) {
  return nearestCity(lat, lng).main;
}
