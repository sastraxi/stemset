import type React from "react";
import { useCallback, useEffect, useState } from "react";

interface InteractivePanelProps {
	children: React.ReactNode;
	selector: string;
	className?: string;
	toggledClassName?: string;
	excludeChildren?: boolean;
}

/**
 * A panel that toggles a class on another element when this element
 * is interacted with (hovered or focused), but NOT if one of its children
 * is interacted with.
 */
export const InteractivePanel = ({
	children,
	selector,
	className,
	toggledClassName = "pointer-events-none",
	excludeChildren = true,
}: InteractivePanelProps) => {
	const [includeClass, setIncludeClass] = useState(false);

	const leave = useCallback(() => {
		// we need to avoid changing includeClass if our "leave" is due to the
		// pointer-events turning to none on our ancestor "selector" element
		const el = document.querySelector(selector);
		const isPointerNone = el && getComputedStyle(el).pointerEvents === "none";
		if (isPointerNone) {
			console.log("Mouse leave ignored due to pointer-events:none on selector");
			return;
		}
		setIncludeClass(false);
	}, [selector]);

	const over = useCallback(
		(event: React.MouseEvent) => {
			if (excludeChildren && event.target !== event.currentTarget) {
				// hovering over a child element
				setIncludeClass(false);
			} else {
				// hovering over the main element
				setIncludeClass(true);
			}
		},
		[selector],
	);

	const focus = useCallback(() => {
		setIncludeClass(true);
	}, [selector]);

	useEffect(() => {
		const el = document.querySelector(selector);
		if (includeClass) {
			el?.classList.add(toggledClassName);
			return () => {
				el?.classList.remove(toggledClassName);
			};
		}
		return () => {};
	}, [toggledClassName, includeClass, selector]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: interaction with sidebar is iffy
		<div
			onMouseLeave={leave}
			onMouseOver={over}
			onFocus={focus}
			className={className}
		>
			{children}
		</div>
	);
};
