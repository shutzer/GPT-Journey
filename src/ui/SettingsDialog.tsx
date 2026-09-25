import { useState } from "react";
import { listModels } from "../ai";
import type { ImageProviderId, Settings, TextProviderId } from "../ai/types";
import { useT } from "./i18n";

type Provider = "claude" | "openai" | "gemini";
const NAMES: Record<Provider, string> = { claude: "Claude (Anthropic)", openai: "OpenAI", gemini: "Gemini (Google)" };

export function SettingsDialog({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [lists, setLists] = useState<Partial<Record<Provider, string[]>>>({});
  const [listError, setListError] = useState<string | null>(null);
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const setKey = (p: Provider, v: string) => set({ keys: { ...settings.keys, [p]: v } });
  const setModel = (k: keyof Settings["models"], v: string) => set({ models: { ...settings.models, [k]: v } });

  async function load(p: Provider) {
    setListError(null);
    try {
      const ids = await listModels(p, settings.keys[p]);
      setLists((l) => ({ ...l, [p]: ids }));
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }

  const providerBlock = (p: Provider) => (
    <div className="provider" key={p}>
      <label className="field">
        <span>{t("settings.key", { name: NAMES[p] })}</span>
        <input type="password" autoComplete="off" spellCheck={false} value={settings.keys[p]} onChange={(e) => setKey(p, e.target.value)} placeholder={p === "claude" ? "sk-ant-…" : p === "openai" ? "sk-…" : "AIza…"} />
      </label>
      <div className="row">
        <label className="field">
          <span>{t("settings.model")}</span>
          <input list={`models-${p}`} value={settings.models[p]} onChange={(e) => setModel(p, e.target.value)} />
        </label>
        {p !== "claude" && (
          <label className="field">
            <span>{t("settings.imageModel")}</span>
            <input
              list={`models-${p}`}
              value={p === "openai" ? settings.models.openaiImage : settings.models.geminiImage}
              onChange={(e) => setModel(p === "openai" ? "openaiImage" : "geminiImage", e.target.value)}
            />
          </label>
        )}
        <button type="button" className="ghost load" onClick={() => load(p)} disabled={!settings.keys[p]}>
          {t("settings.load")}
        </button>
      </div>
      <datalist id={`models-${p}`}>
        {(lists[p] ?? []).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {p === "claude" && (
        <label className="check">
          <input type="checkbox" checked={settings.claudeFallbacks} onChange={(e) => set({ claudeFallbacks: e.target.checked })} />
          <span>{t("settings.fallbacks")}</span>
        </label>
      )}
    </div>
  );

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">{t("settings.title")}</h2>

        <h3>{t("settings.text")}</h3>
        <div className="segmented wide">
          {(["claude", "openai", "gemini", "demo"] as TextProviderId[]).map((id) => (
            <button key={id} type="button" className={settings.text === id ? "on" : ""} onClick={() => set({ text: id })}>
              {id === "demo" ? t("settings.demo") : NAMES[id].split(" ")[0]}
            </button>
          ))}
        </div>

        <h3>{t("settings.image")}</h3>
        <div className="segmented wide">
          {(["gemini", "openai", "none"] as ImageProviderId[]).map((id) => (
            <button key={id} type="button" className={settings.image === id ? "on" : ""} onClick={() => set({ image: id })}>
              {id === "none" ? t("settings.none") : NAMES[id].split(" ")[0]}
            </button>
          ))}
        </div>

        {(["claude", "openai", "gemini"] as Provider[]).map(providerBlock)}
        {listError && <p className="error">{listError}</p>}

        <label className="check">
          <input type="checkbox" checked={settings.rememberKeys} onChange={(e) => set({ rememberKeys: e.target.checked })} />
          <span>{t("settings.remember")}</span>
        </label>
        <p className="muted small">{t("settings.keysNote")}</p>

        <div className="dialog-actions">
          <button className="primary" onClick={onClose}>
            {t("settings.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
