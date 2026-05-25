import { useCallback, useEffect, useState } from "react";
import { Loader, Portal, Stack, Text, Button, Alert } from "@mantine/core";
import { useYearSummary } from "../../hooks/useYearSummary";
import { SLIDES, YearInReviewSlides } from "./YearInReviewSlides";

type YearInReviewOverlayProps = {
  year: number;
  onClose: () => void;
};

export function YearInReviewOverlay({ year, onClose }: YearInReviewOverlayProps) {
  const { data, loading, error, load } = useYearSummary(year);
  const [idx, setIdx] = useState(0);
  const total = SLIDES.length;

  useEffect(() => {
    void load();
  }, [load]);

  const go = useCallback(
    (dir: number) => setIdx((i) => Math.max(0, Math.min(total - 1, i + dir))),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  useEffect(() => {
    let sx: number | null = null;
    const onStart = (e: TouchEvent) => { sx = e.changedTouches[0].clientX; };
    const onEnd = (e: TouchEvent) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
      sx = null;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [go]);

  const slide = SLIDES[idx];

  return (
    <Portal>
      <div className="yr-shell">
        {/* Ambient glow per slide */}
        <div
          className="yr-bg"
          style={{ background: slide.glow === "none" ? "transparent" : slide.glow }}
        />

        {/* Story progress bar */}
        <div className="yr-progress" aria-hidden="true">
          {SLIDES.map((s, i) => (
            <div
              key={s.key}
              className="yr-progress-seg"
              onClick={() => setIdx(i)}
            >
              <div
                className="yr-progress-fill"
                style={{
                  width: i <= idx ? "100%" : "0%",
                  background: i < idx ? "rgba(240,233,216,0.5)" : "rgba(240,233,216,0.72)",
                }}
              />
            </div>
          ))}
        </div>

        {/* Top chrome */}
        <div className="yr-chrome">
          <div className="yr-chrome-left">
            <button className="yr-icon-btn" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="yr-chrome-right">
            <span className="yr-chrome-counter">
              {idx + 1} / {total}
            </span>
          </div>
        </div>

        {/* Slide content */}
        {loading ? (
          <Stack
            align="center"
            justify="center"
            style={{ position: "absolute", inset: 0, zIndex: 3 }}
            gap="md"
          >
            <Loader color="rgba(240,233,216,0.6)" />
            <Text ta="center" style={{ color: "rgba(240,233,216,0.45)", maxWidth: 320 }} size="sm">
              Generating your year in review… this takes about 30 seconds the first time.
            </Text>
          </Stack>
        ) : error ? (
          <Stack
            align="center"
            justify="center"
            style={{ position: "absolute", inset: 0, zIndex: 3 }}
            px="xl"
          >
            <Alert color="red" title="Could not load year summary" style={{ maxWidth: 400 }}>
              {error}
            </Alert>
            <Button variant="subtle" color="gray" onClick={() => void load()}>
              Retry
            </Button>
          </Stack>
        ) : data ? (
          <YearInReviewSlides
            idx={idx}
            data={data.data}
            narrative={data.narrative}
            onClose={onClose}
            onNext={() => go(1)}
            year={year}
          />
        ) : null}

        {/* Tap zones (mobile) */}
        {data && (
          <>
            <div
              className="yr-tap-prev"
              onClick={() => go(-1)}
              aria-label="Previous"
            />
            <div
              className="yr-tap-next"
              onClick={() => go(1)}
              aria-label="Next"
            />
          </>
        )}

        {/* Bottom nav arrows */}
        {data && (
          <nav className="yr-nav" aria-label="Slide navigation">
            <button
              className="yr-arrow"
              onClick={() => go(-1)}
              disabled={idx === 0}
              aria-label="Previous"
            >
              ←
            </button>
            <span className="yr-slide-label">{slide.label || "Grove"}</span>
            <button
              className="yr-arrow"
              onClick={() => go(1)}
              disabled={idx === total - 1}
              aria-label="Next"
            >
              →
            </button>
          </nav>
        )}
      </div>
    </Portal>
  );
}
