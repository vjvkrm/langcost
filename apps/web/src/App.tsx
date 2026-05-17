import { useEffect, useMemo, useState } from "react";

import { getSources, type SourceInfo, triggerScan } from "./api/client";
import { Header } from "./components/layout/Header";
import { Overview } from "./pages/Overview";
import { Sessions } from "./pages/Sessions";
import { Settings } from "./pages/Settings";
import { TraceDetail } from "./pages/TraceDetail";

type Route =
  | { page: "traces" }
  | { page: "overview" }
  | { page: "settings" }
  | { page: "trace"; traceId: string };

function parseRoute(pathname: string): Route {
  if (pathname.startsWith("/traces/")) {
    const traceId = pathname.replace(/^\/traces\//, "");
    return { page: "trace", traceId: decodeURIComponent(traceId) };
  }

  if (pathname === "/overview") {
    return { page: "overview" };
  }

  if (pathname === "/settings") {
    return { page: "settings" };
  }

  return { page: "traces" };
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    const savedTheme = window.localStorage.getItem("langcost-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [activeSource, setActiveSource] = useState<string | undefined>(() => {
    return window.localStorage.getItem("langcost-source") ?? undefined;
  });
  const [billingMode, setBillingMode] = useState<"subscription" | "api">(() => {
    const saved = window.localStorage.getItem("langcost-billing");
    return saved === "api" ? "api" : "subscription";
  });
  const [loadingShell, setLoadingShell] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerTone, setBannerTone] = useState<"info" | "error">("info");

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("langcost-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (banner === null || bannerTone !== "info") return;
    const timer = window.setTimeout(() => setBanner(null), 5000);
    return () => window.clearTimeout(timer);
  }, [banner, bannerTone]);

  function handleSourceChange(source: string | undefined) {
    setActiveSource(source);
    if (source) {
      window.localStorage.setItem("langcost-source", source);
    } else {
      window.localStorage.removeItem("langcost-source");
    }
    setRefreshToken((current) => current + 1);
  }

  function handleBillingModeChange(mode: "subscription" | "api") {
    setBillingMode(mode);
    window.localStorage.setItem("langcost-billing", mode);
  }

  async function reloadShell() {
    const nextSources = await getSources();
    setSources(nextSources.sources);

    const sourceNames = nextSources.sources.map((s) => s.name);
    if (activeSource && !sourceNames.includes(activeSource)) {
      handleSourceChange(sourceNames[0]);
    } else if (!activeSource && sourceNames.length === 1) {
      handleSourceChange(sourceNames[0]);
    }

    setRefreshToken((current) => current + 1);
  }

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const nextSources = await getSources();

        if (!active) {
          return;
        }

        setSources(nextSources.sources);

        const sourceNames = nextSources.sources.map((s) => s.name);
        const saved = window.localStorage.getItem("langcost-source") ?? undefined;
        if (saved && sourceNames.includes(saved)) {
          setActiveSource(saved);
        } else if (sourceNames.length >= 1 && sourceNames[0]) {
          const pick = sourceNames[0];
          setActiveSource(pick);
          window.localStorage.setItem("langcost-source", pick);
        }
      } catch (cause) {
        if (!active) {
          return;
        }

        setBanner(cause instanceof Error ? cause.message : "Failed to initialize dashboard.");
        setBannerTone("error");
      } finally {
        if (active) {
          setLoadingShell(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const hasData = sources.length > 0;
  const route = useMemo(() => parseRoute(pathname), [pathname]);
  const activePath = route.page === "trace" || route.page === "traces" ? "/" : pathname;

  function navigate(path: string) {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }

    setPathname(path);
  }

  useEffect(() => {
    if (loadingShell) return;
    if (hasData) return;
    if (pathname === "/settings") return;
    if (pathname === "/" || pathname === "/overview") {
      navigate("/settings");
    }
  }, [loadingShell, hasData, pathname]);

  async function handleRefresh() {
    if (!hasData || !activeSource) {
      return;
    }

    setRefreshing(true);
    setBanner(null);

    try {
      const result = await triggerScan(false, activeSource);
      await reloadShell();
      setBanner(`Refresh complete. Ingested ${result.tracesIngested} new traces from ${activeSource}.`);
      setBannerTone("info");
    } catch (cause) {
      setBanner(cause instanceof Error ? cause.message : "Refresh failed.");
      setBannerTone("error");
    } finally {
      setRefreshing(false);
    }
  }

  if (loadingShell) {
    return (
      <div className="page-shell">
        <div className="panel p-8 text-sm text-slate-400">Loading dashboard shell...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header
        currentPath={activePath}
        onNavigate={navigate}
        onRefresh={() => void handleRefresh()}
        refreshing={refreshing}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        sources={sources}
        activeSource={activeSource}
        onSourceChange={handleSourceChange}
        billingMode={billingMode}
        onBillingModeChange={handleBillingModeChange}
      />

      <main className="page-shell">
        {refreshing ? (
          <div className="banner banner--info flex items-center gap-3">
            <span className="spinner" aria-hidden="true" />
            <span>Scanning {activeSource ?? "configured source"} for new traces…</span>
          </div>
        ) : banner ? (
          <div className={`banner ${bannerTone === "error" ? "banner--error" : "banner--info"}`}>
            {banner}
          </div>
        ) : null}

        {route.page === "traces" ? (
          <Sessions
            refreshToken={refreshToken}
            onNavigate={navigate}
            source={activeSource}
            billingMode={billingMode}
          />
        ) : null}
        {route.page === "overview" ? (
          <Overview
            refreshToken={refreshToken}
            onNavigate={navigate}
            source={activeSource}
            billingMode={billingMode}
          />
        ) : null}
        {route.page === "settings" ? <Settings onShellRefresh={reloadShell} /> : null}
        {route.page === "trace" ? (
          <TraceDetail
            traceId={route.traceId}
            refreshToken={refreshToken}
            onBack={() => navigate("/")}
          />
        ) : null}
      </main>
    </div>
  );
}
