import "./spinner.css";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  const sizeClasses = {
    sm: "spinner-sm",
    md: "spinner-md",
    lg: "spinner-lg",
  };

  return (
    <div className={`spinner ${sizeClasses[size]} ${className}`}>
      <div className="spinner-circle"></div>
    </div>
  );
}
