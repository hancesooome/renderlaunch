import { useEffect, useState } from "react";
import { loadAssetBlob } from "../persistence/database";

type AssetUrlState = {
  assetId?: string;
  url?: string;
  status: "idle" | "loading" | "ready" | "missing" | "error";
};

export function useAssetUrl(assetId?: string) {
  const [state, setState] = useState<AssetUrlState>({ status: "idle" });
  useEffect(() => {
    let active = true,
      objectUrl: string | undefined;
    if (!assetId) {
      setState({ status: "idle" });
      return;
    }
    setState({ assetId, status: "loading" });
    void loadAssetBlob(assetId)
      .then((blob) => {
        if (!active) return;
        if (!blob) {
          setState({ assetId, status: "missing" });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setState({ assetId, url: objectUrl, status: "ready" });
      })
      .catch(() => {
        if (active) setState({ assetId, status: "error" });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);
  const loadingState: AssetUrlState = { assetId, status: "loading" };
  return state.assetId === assetId ? state : loadingState;
}
