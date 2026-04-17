import { useMemo } from 'react';
import Lottie from 'lottie-react';
import animationData from '../assets/lottie-success.json';

interface SuccessCheckLottieProps {
  className?: string;
  /** Pixel size of the animation box. */
  size?: number;
}

export function SuccessCheckLottie({ className = '', size = 96 }: SuccessCheckLottieProps) {
  const style = useMemo(() => ({ width: size, height: size }), [size]);

  return (
    <div
      className={`pointer-events-none flex items-center justify-center ${className}`}
      aria-hidden
    >
      <Lottie
        animationData={animationData}
        loop={false}
        style={style}
      />
    </div>
  );
}
