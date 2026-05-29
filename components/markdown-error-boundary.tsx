"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  resetKey?: string;
}

interface State {
  hasError: boolean;
  resetKey?: string;
}

export class MarkdownErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(nextProps: Props, prevState: State): Partial<State> | null {
    if (nextProps.resetKey !== prevState.resetKey) {
      return { hasError: false, resetKey: nextProps.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error) {
    if (typeof console !== "undefined") {
      console.error("[markdown] render error", error);
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
