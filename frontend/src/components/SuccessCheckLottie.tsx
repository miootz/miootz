import { useMemo } from 'react';
import { useLottie } from 'lottie-react';
import animationData from '../assets/lottie-success.json';

interface SuccessCheckLottieProps {
  className?: string;
  /** Pixel size of the animation box. */
  size?: number;
}

export function SuccessCheckLottie({ className = '', size = 96 }: SuccessCheckLottieProps) {
  const style = useMemo(() => ({ width: size, height: size }), [size]);

  const options = useMemo(
    () => ({
      animationData,
      loop: false,
      autoplay: true,
    }),
    []
  );

  const { View } = useLottie(options, style);

  return (
    <div
      className={`pointer-events-none flex items-center justify-center ${className}`}
      aria-hidden
    >
      {View}
    </div>
  );
}
