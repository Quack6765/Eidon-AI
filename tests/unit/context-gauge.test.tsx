// @vitest-environment jsdom

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextGauge } from "@/components/context-gauge";

describe("ContextGauge", () => {
  const defaultProps = {
    usedTokens: 50000,
    usableLimit: 80000,
    maxLimit: 100000
  };

  it("renders circular gauge with percentage fill", () => {
    render(<ContextGauge {...defaultProps} />);

    // Should show threshold-relative percentage label
    expect(screen.getByText("63%")).toBeInTheDocument();

    // Should have progressbar role for accessibility
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows at least 1% when usage is nonzero but below half a percent", () => {
    render(<ContextGauge usedTokens={1} usableLimit={80000} maxLimit={100000} />);

    expect(screen.getByText("1%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });

  it("shows green color when usage is below 50%", () => {
    render(<ContextGauge {...defaultProps} usedTokens={30000} />);

    const gauge = screen.getByRole("progressbar");
    expect(gauge).toHaveAttribute("aria-valuenow", "38");

    const progressCircle = gauge.querySelector('circle[stroke="#22c55e"]');
    expect(progressCircle).toBeInTheDocument();
  });

  it("shows yellow color when usage is between 50-70%", () => {
    render(<ContextGauge {...defaultProps} usedTokens={55000} />);

    const gauge = screen.getByRole("progressbar");
    expect(gauge).toHaveAttribute("aria-valuenow", "69");

    const progressCircle = gauge.querySelector('circle[stroke="#eab308"]');
    expect(progressCircle).toBeInTheDocument();
  });

  it("shows red color when usage is above 70%", () => {
    render(<ContextGauge {...defaultProps} usedTokens={60000} />);

    const gauge = screen.getByRole("progressbar");
    expect(gauge).toHaveAttribute("aria-valuenow", "75");

    const progressCircle = gauge.querySelector('circle[stroke="#ef4444"]');
    expect(progressCircle).toBeInTheDocument();
  });

  it("displays tooltip on hover with compact format", async () => {
    render(<ContextGauge {...defaultProps} />);

    const gauge = screen.getByRole("progressbar");
    fireEvent.mouseEnter(gauge);

    expect(screen.getByText(/50K used/)).toBeInTheDocument();
    expect(screen.getByText(/80K usable/)).toBeInTheDocument();
    expect(screen.getByText(/100K/)).toBeInTheDocument();
  });

  it("hides tooltip when mouse leaves", async () => {
    render(<ContextGauge {...defaultProps} />);

    const gauge = screen.getByRole("progressbar");
    fireEvent.mouseEnter(gauge);
    expect(screen.getByText(/50K used/)).toBeInTheDocument();

    fireEvent.mouseLeave(gauge);
    expect(screen.queryByText(/50K used/)).not.toBeInTheDocument();
  });

  it("shows the visible label as percentage for large token counts", () => {
    render(<ContextGauge {...defaultProps} usedTokens={1500} />);
    expect(screen.getByText("2%")).toBeInTheDocument();
  });

  it("shows the visible label as percentage for million-scale token counts", () => {
    render(<ContextGauge {...defaultProps} usedTokens={1500000} usableLimit={2000000} maxLimit={2000000} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("formats large token counts with K suffix in the tooltip", () => {
    render(<ContextGauge {...defaultProps} usedTokens={1500} />);

    const gauge = screen.getByRole("progressbar");
    fireEvent.mouseEnter(gauge);

    expect(screen.getByText(/1.5K used/)).toBeInTheDocument();
  });

  it("formats millions with M suffix in the tooltip", () => {
    render(<ContextGauge {...defaultProps} usedTokens={1500000} usableLimit={2000000} maxLimit={2000000} />);

    const gauge = screen.getByRole("progressbar");
    fireEvent.mouseEnter(gauge);

    expect(screen.getByText(/1.5M used/)).toBeInTheDocument();
  });

  it("caps the label at 100% when usage exceeds the compaction threshold", () => {
    render(<ContextGauge {...defaultProps} usedTokens={95000} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("toggles tooltip on mobile tap", () => {
    render(<ContextGauge {...defaultProps} />);

    const gauge = screen.getByRole("progressbar");
    fireEvent.click(gauge);

    expect(screen.getByText(/50K used/)).toBeInTheDocument();

    // Tap again to hide
    fireEvent.click(gauge);
    expect(screen.queryByText(/50K used/)).not.toBeInTheDocument();
  });

  it("does not render when usedTokens is null", () => {
    const { container } = render(
      <ContextGauge usedTokens={null} usableLimit={80000} maxLimit={100000} />
    );
    expect(container.firstChild).toBeNull();
  });
});
