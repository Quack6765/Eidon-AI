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

    // Should show used tokens label
    expect(screen.getByText("50K")).toBeInTheDocument();

    // Should have progressbar role for accessibility
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
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

  it("formats large token counts with K suffix", () => {
    render(<ContextGauge {...defaultProps} usedTokens={1500} />);
    expect(screen.getByText("1.5K")).toBeInTheDocument();
  });

  it("formats millions with M suffix", () => {
    render(<ContextGauge {...defaultProps} usedTokens={1500000} usableLimit={2000000} maxLimit={2000000} />);
    expect(screen.getByText("1.5M")).toBeInTheDocument();
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