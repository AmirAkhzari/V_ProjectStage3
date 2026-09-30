import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BackHeader from "@/components/layout/BackHeader";
import { IconMapPin, IconSearch, IconX } from "@/components/icons";
import { CITIES } from "@/data/cities";
import { scoreText } from "@/lib/search";
import { normalizePersian } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = normalizePersian(text).indexOf(normalizePersian(query));
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-accent font-extrabold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function AddressSearchPage() {
  const navigate = useNavigate();
  const setDraftPin = useAppStore((s) => s.setDraftPin);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return CITIES
      .map((c) => ({ ...c, s: Math.max(scoreText(c.main, query), scoreText(c.sub, query) * 0.6) }))
      .filter((c) => c.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);
  }, [query]);

  return (
    <div className="flex-1 flex flex-col bg-page min-h-0">
      <BackHeader />
      <div className="px-5">
        <h1 className="text-[26px] font-extrabold mb-4">جستجوی آدرس</h1>
        <div className="flex items-center gap-2.5 h-[52px] px-3.5 rounded-2xl border border-border focus-within:border-accent bg-card">
          <IconSearch color="#8E8E93" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="نام شهر، محله یا خیابان..." className="flex-1 bg-transparent outline-none" />
          {query && <button type="button" onClick={() => setQuery("")}><IconX size={16} color="#8E8E93" /></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto mt-2">
        {!query && <p className="p-10 text-center text-text-secondary text-[13px] leading-8">برای مثال «ته» را تایپ کنید تا تهران پیشنهاد داده شود</p>}
        {query && results.length === 0 && <p className="p-10 text-center text-text-secondary">نتیجه‌ای یافت نشد</p>}
        {results.map((r) => (
          <button
            key={r.main}
            type="button"
            onClick={() => {
              setDraftPin({ city: r.main, lat: r.lat, lng: r.lng, streetLabel: r.main });
              navigate("/addresses/map");
            }}
            className="w-full flex items-center gap-3.5 px-5 py-3.5 border-b border-border"
          >
            <div className="w-9 h-9 rounded-[10px] bg-brand-tint flex items-center justify-center">
              <IconMapPin size={18} color="#8E8E93" />
            </div>
            <div className="flex-1 text-right">
              <div className="font-semibold"><Highlight text={r.main} query={query} /></div>
              <div className="text-[13px] text-text-secondary mt-0.5"><Highlight text={r.sub} query={query} /></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
