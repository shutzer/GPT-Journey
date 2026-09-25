import { useEffect, useMemo, useState } from "react";
import { modelLabel } from "../ai";
import type { Settings } from "../ai/types";
import { loadSettings, saveSettings } from "../store/persist";
import { CaseView } from "./CaseView";
import { Home } from "./Home";
import { I18n, translator, type UiLang } from "./i18n";
import { SettingsDialog } from "./SettingsDialog";

function initialUiLang(): UiLang {
  try {
    const saved = localStorage.getItem("caseFiles.uiLang");
    if (saved === "en" || saved === "hr") return saved;
  } catch {}
  return navigator.language?.startsWith("hr") ? "hr" : "en";
}

function useHashRoute(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [uiLang, setUiLang] = useState<UiLang>(initialUiLang);
  const [showSettings, setShowSettings] = useState(false);
  const t = useMemo(() => translator(uiLang), [uiLang]);
  const hash = useHashRoute();
  const caseId = hash.match(/^#\/case\/([\w-]+)$/)?.[1];

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => {
    document.documentElement.lang = uiLang;
    try {
      localStorage.setItem("caseFiles.uiLang", uiLang);
    } catch {}
  }, [uiLang]);

  return (
    <I18n.Provider value={t}>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark">⌕</span> {t("app.name")}
        </a>
        <div className="topbar-right">
          <span className="badge" title={settings.text}>{modelLabel(settings)}</span>
          <button className="ghost" onClick={() => setUiLang(uiLang === "en" ? "hr" : "en")} aria-label={t("settings.uiLang")}>
            {uiLang === "en" ? "HR" : "EN"}
          </button>
          <button onClick={() => setShowSettings(true)}>{t("nav.settings")}</button>
        </div>
      </header>
      {caseId ? (
        <CaseView key={caseId} id={caseId} settings={settings} />
      ) : (
        <Home settings={settings} uiLang={uiLang} onOpenSettings={() => setShowSettings(true)} />
      )}
      {showSettings && <SettingsDialog settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
    </I18n.Provider>
  );
}
