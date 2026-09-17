import { useEffect, useState } from "react";

// Never server-rendered: the component only reads browser-only APIs.
export const client = "only";

interface PageTool {
  name: string;
  description?: string;
}

interface WebMcpProbe {
  supported: boolean;
  tools: PageTool[];
}

const boxStyle = {
  border: "1px solid var(--blume-accent, currentColor)",
  borderRadius: 12,
  padding: "12px 16px",
} as const;

const readModelContext = (): {
  getTools?: () => Promise<PageTool[]>;
} | null => {
  const doc = document as Document & {
    modelContext?: { getTools?: () => Promise<PageTool[]> };
  };
  if (doc.modelContext) {
    return doc.modelContext;
  }
  const nav = navigator as Navigator & {
    modelContext?: { getTools?: () => Promise<PageTool[]> };
  };
  return nav.modelContext ?? null;
};

export default function WebMcpStatus() {
  const [probe, setProbe] = useState<WebMcpProbe | null>(null);

  useEffect(() => {
    let cancelled = false;
    const modelContext = readModelContext();
    if (!modelContext?.getTools) {
      setProbe({ supported: Boolean(modelContext), tools: [] });
      return;
    }
    modelContext
      .getTools()
      .then((tools) => {
        if (!cancelled) {
          setProbe({ supported: true, tools: tools ?? [] });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProbe({ supported: true, tools: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!probe) {
    return (
      <div data-supported="checking" data-testid="webmcp-status" style={boxStyle}>
        Checking this browser for WebMCP support…
      </div>
    );
  }

  if (!probe.supported) {
    return (
      <div data-supported="false" data-testid="webmcp-status" style={boxStyle}>
        <strong>This browser does not expose WebMCP yet.</strong> Teak&apos;s
        in-browser tools appear once your browser ships{" "}
        <code>document.modelContext</code> — Chrome&apos;s WebMCP preview needs
        its experimental flag enabled.
      </div>
    );
  }

  return (
    <div data-supported="true" data-testid="webmcp-status" style={boxStyle}>
      <strong>This browser supports WebMCP.</strong>{" "}
      {probe.tools.length === 0 ? (
        <>
          No tools are registered on this docs page. Sign in to the Teak web
          app, where <code>teak_search_cards</code> and{" "}
          <code>teak_get_card</code> are registered for your session.
        </>
      ) : (
        <>
          Tools on this page:{" "}
          {probe.tools.map((tool) => tool.name).join(", ")}
        </>
      )}
    </div>
  );
}
