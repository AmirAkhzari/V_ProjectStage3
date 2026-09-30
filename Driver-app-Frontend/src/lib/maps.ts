import type { ShopInfo } from "@/types";

export type MapTarget = { id: string; label: string; href: string };

/**
 * Hand-off to an external map app. The driver app does no routing of its own.
 * `geo:` opens the Android app chooser (Neshan, Balad, Google Maps …); iOS gets Apple Maps.
 */
export function mapTargets(shop: ShopInfo, userAgent = navigator.userAgent): MapTarget[] {
  const hasPoint = shop.lat != null && shop.lng != null;
  const point = hasPoint ? `${shop.lat},${shop.lng}` : "";
  const query = encodeURIComponent(`${shop.address}، ${shop.city}`);
  const destination = hasPoint ? point : query;
  const isIos = /iPad|iPhone|iPod/.test(userAgent);
  const isAndroid = /Android/.test(userAgent);

  const targets: MapTarget[] = [];
  if (isAndroid) {
    targets.push({
      id: "geo",
      label: "انتخاب برنامه مسیریاب",
      href: hasPoint ? `geo:${point}?q=${point}(${encodeURIComponent(shop.name)})` : `geo:0,0?q=${query}`,
    });
  }
  if (isIos) {
    targets.push({ id: "apple", label: "Apple Maps", href: `https://maps.apple.com/?daddr=${destination}` });
  }
  targets.push({
    id: "google",
    label: "Google Maps",
    href: `https://www.google.com/maps/dir/?api=1&destination=${destination}`,
  });
  return targets;
}
