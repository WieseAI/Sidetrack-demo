import { useEffect, useRef, useState } from "preact/hooks";
import { useStorageHandle } from "../state/storage";
import type { PersistedState } from "../../shared/model";
import { resolveTheme, themeLabel, type ThemeOverride } from "../../shared/theme";

/**
 * Settings dialog.
 *
 * Phase 3 ships one setting: the idle threshold in minutes
 * (default 5, configurable from 1 to 30). The setting is
 * read from `state.settings.idleThresholdSeconds` and
 * written via the storage handle's mutate() helper
 * (action: `set-setting`).
 *
 * The dialog is intentionally minimal: a single labeled
 * number input, a one-line description, and the Cancel /
 * Save pair. We do not introduce a separate settings page
 * (D-02).
 */
export interface SettingsDialogProps {
  state: PersistedState;
  onClose: () => void;
}

const MIN_THRESHOLD_SECONDS = 60; // 1 minute
const MAX_THRESHOLD_SECONDS = 30 * 60; // 30 minutes
const DEFAULT_THRESHOLD_SECONDS = 5 * 60;

export function SettingsDialog({ state, onClose }: SettingsDialogProps) {
  const storage = useStorageHandle();
  const [minutes, setMinutes] = useState<number>(
    Math.round(state.settings.idleThresholdSeconds / 60),
  );
  const [theme, setTheme] = useState<ThemeOverride>(state.settings.theme);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const seconds = minutes * 60;
  const isValid =
    Number.isFinite(minutes) &&
    minutes >= 1 &&
    minutes <= 30 &&
    seconds >= MIN_THRESHOLD_SECONDS &&
    seconds <= MAX_THRESHOLD_SECONDS;

  async function save() {
    if (!isValid) {
      setError("Threshold must be between 1 and 30 minutes.");
      return;
    }
    setError(null);
    // Two writes; both are atomic reducer actions, both go
    // through the storage serialization lock, so the order
    // does not matter (the on-disk blob ends with both
    // settings applied).
    await storage.mutate({
      type: "set-setting",
      key: "idleThresholdSeconds",
      value: seconds,
    });
    if (theme !== state.settings.theme) {
      await storage.mutate({
        type: "set-setting",
        key: "theme",
        value: theme,
      });
    }
    onClose();
  }

  return (
    <div class="dialog-backdrop" onClick={onClose}>
      <div
        class="dialog dialog--settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="dialog__header">
          <h2 class="dialog__title" id="settings-title">
            Settings
          </h2>
        </header>
        <div class="dialog__body">
          <label class="settings__row">
            <span class="settings__label">Idle threshold (minutes)</span>
            <input
              ref={inputRef}
              class="settings__input"
              type="number"
              inputMode="numeric"
              min={1}
              max={30}
              step={1}
              value={String(minutes)}
              onInput={(e) => {
                const v = Number((e.currentTarget as HTMLInputElement).value);
                setMinutes(v);
                setError(null);
              }}
              data-testid="settings-threshold-input"
            />
          </label>
          <p class="settings__help">
            How long the timer runs without activity before
            Sidetrack asks you to keep, trim, or stop it.
            Default is {Math.round(DEFAULT_THRESHOLD_SECONDS / 60)} minutes.
          </p>
          <div class="settings__row settings__row--theme">
            <span class="settings__label">Theme</span>
            <div
              class="settings__theme-group"
              role="radiogroup"
              aria-label="Theme"
            >
              {(["system", "light", "dark"] as const).map((opt) => (
                <label
                  key={opt}
                  class={`settings__theme-option${theme === opt ? " settings__theme-option--active" : ""}`}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={opt}
                    checked={theme === opt}
                    onChange={() => setTheme(opt)}
                    data-testid={`settings-theme-${opt}`}
                  />
                  <span>{themeLabel(opt)}</span>
                </label>
              ))}
            </div>
          </div>
          <p class="settings__help">
            Light, dark, or follow the system preference. The
            active theme is "{themeLabel(resolveTheme(theme))}".
          </p>
          {error ? <p class="settings__error" role="alert">{error}</p> : null}
        </div>
        <footer class="dialog__footer">
          <button class="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            class="btn btn--primary"
            type="button"
            onClick={save}
            data-testid="settings-save"
            disabled={!isValid}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
