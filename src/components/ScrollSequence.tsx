import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const ScrollSequence = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && textRef.current && cardRef.current) {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top center",
          end: "bottom center",
          scrub: 1,
        }
      });

      tl.to(textRef.current, {
        scale: 1.2,
        opacity: 0,
        y: -50,
        duration: 1
      }, 0);

      tl.fromTo(cardRef.current, 
        { y: 100, opacity: 0, rotationX: 45 },
        { y: 0, opacity: 1, rotationX: 0, duration: 1 },
        0.5
      );
    }
  }, []);

  return (
    <div ref={containerRef} style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', perspective: '1000px' }}>
      <h2 ref={textRef} style={{ fontSize: '3.5rem', textAlign: 'center', marginBottom: '40px' }}>
        Experience the power of<br/>
        <span style={{ color: 'var(--primary)' }}>Algorithmic Trading</span>
      </h2>
      
      <div ref={cardRef} className="glass-panel" style={{ padding: '40px', width: '80%', maxWidth: '800px', textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.5rem', color: 'var(--text-muted)', marginBottom: '20px' }}>Frame-by-Frame Precision</h3>
        <p style={{ fontSize: '1.1rem', lineHeight: '1.6' }}>
          Our deterministic backtest loop processes data candle by candle, ensuring that your simulated results match real-world execution. With integrated 3D visualization, you can explore the multi-dimensional payoff landscapes of complex options strategies like never before.
        </p>
      </div>
    </div>
  );
};
