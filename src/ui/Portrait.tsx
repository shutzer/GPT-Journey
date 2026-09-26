import type { Suspect } from "../game/schema";
import type { CaseRecord } from "../game/state";

export function Portrait({ record, suspect, size = 64 }: { record: CaseRecord; suspect: Suspect; size?: number }) {
  const url = record.images.portraits[suspect.id];
  const initials = suspect.name.split(/\s+/).map((w) => w[0]).slice(-2).join("");
  let hue = 0;
  for (const ch of suspect.id + suspect.name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div className="portrait" style={{ width: size, height: size, background: url ? undefined : `hsl(${hue} 30% 22%)` }}>
      {url ? <img src={url} alt={suspect.name} draggable={false} /> : <span style={{ fontSize: size * 0.36 }}>{initials}</span>}
    </div>
  );
}
