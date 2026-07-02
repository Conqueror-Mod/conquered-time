// ─── Phase-1 scaffolding — DELETE when the renderer pages convert to .ts ───
//
// The page files reach DOM elements via document.getElementById()/querySelector()
// and use the result directly as an input/select/canvas etc. TypeScript types
// those lookups as HTMLElement/Element, which yields ~240 mechanical TS2339
// "property does not exist" errors that say nothing about correctness.
//
// Rather than scattering ~240 JSDoc casts (churn) or @ts-ignore lines (blind
// suppression) across every page, this file widens the base DOM interfaces with
// the exact members the codebase accesses, typed truthfully — so real misuse
// (e.g. assigning a number to .value, calling .focus with args) still fails.
//
// Phase 3 (per-page .ts conversion) replaces these with proper `as HTMLInputElement`
// casts page by page; when the last page converts, delete this file and the
// typecheck must stay clean.

interface HTMLElement {
  // form-control members (HTMLInput/Select/TextArea/Button/Option)
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  type?: string;
  placeholder?: string;
  selectedIndex?: number;
  options?: HTMLOptionsCollection;
  valueAsDate?: Date | null;
  // media / canvas
  src?: string;
  width?: number;
  height?: number;
  getContext?(contextId: '2d', options?: unknown): CanvasRenderingContext2D | null;
}

interface Element {
  // HTMLElement members used on querySelector()/closest() results
  dataset?: DOMStringMap;
  style?: CSSStyleDeclaration;
  focus?(options?: FocusOptions): void;
}

interface EventTarget {
  /** Element.closest, used on e.target in the delegated dispatchers. */
  closest?(selectors: string): Element | null;
}

interface Event {
  // KeyboardEvent / MouseEvent / CustomEvent members read off plain `Event`
  // handler params in the delegation code.
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  detail?: any;
}
