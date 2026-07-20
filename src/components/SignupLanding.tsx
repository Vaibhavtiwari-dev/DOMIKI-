import { useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Icosahedron, Float } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const CoreMonolith = () => {
  const groupRef = useRef<any>(null);
  const meshRefInner = useRef<any>(null);

  useEffect(() => {
    if (groupRef.current) {
      // Frame-by-frame scroll-triggered 3D animation
      gsap.to(groupRef.current.rotation, {
        y: Math.PI * 2,
        x: Math.PI / 2,
        scrollTrigger: {
          trigger: '.split-layout',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.5,
        }
      });
      
      gsap.to(groupRef.current.position, {
        y: -1,
        z: 2,
        scrollTrigger: {
          trigger: '.split-layout',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1,
        }
      });
    }
  }, []);

  useFrame((state) => {
    if (meshRefInner.current) {
      // Subtle constant ambient movement
      meshRefInner.current.rotation.x = state.clock.getElapsedTime() * -0.1;
      meshRefInner.current.rotation.z = state.clock.getElapsedTime() * 0.05;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
      <group ref={groupRef}>
        <Icosahedron args={[2.5, 1]}>
          <meshStandardMaterial 
            color="#E2E8F0" 
            wireframe={true} 
            roughness={0.2}
            metalness={0.9}
            emissive="#171717"
            emissiveIntensity={0.5}
          />
        </Icosahedron>
        <Icosahedron ref={meshRefInner} args={[1.5, 0]}>
          <meshStandardMaterial 
            color="#CCFF00" 
            wireframe={true} 
            transparent
            opacity={0.8}
            emissive="#CCFF00"
            emissiveIntensity={2}
          />
        </Icosahedron>
      </group>
    </Float>
  );
};

const GlitchForm = () => {
  const navigate = useNavigate();

  const enterDemo = () => {
    window.localStorage.setItem('dokimi_demo_mode', 'true');
    navigate('/demo');
  };

  return (
    <div className="form-section">
      <div className="form-content-wrapper">
        <h2 className="form-heading">Request<br/>Access.</h2>
        <p className="form-subtext">
          Institutional-grade options research and deterministic execution. Limited private alpha.
        </p>
        
        <form onSubmit={(e) => e.preventDefault()} className="avant-form">
          <div className="input-group">
            <input type="text" placeholder="IDENTITY [EMAIL]" className="avant-input" required />
          </div>
          <div className="input-group">
            <input type="password" placeholder="PASSPHRASE" className="avant-input" required />
          </div>
          
          <div className="form-actions">
            <button className="btn-avant" type="button" onClick={enterDemo}>Initialize Session</button>
          </div>
        </form>
        
        <div className="form-footer">
          <p className="footer-tag">SEC // SEBI // ALG-7</p>
          <p className="footer-tag">PROJECT DOKIMI &copy; 2026</p>
        </div>
      </div>
    </div>
  );
}

export const SignupLanding = () => {
  return (
    <div className="split-layout">
      <div className="noise-overlay"></div>
      
      <div className="canvas-wrapper">
        <h1 className="huge-text absolute-center">
          DOKIMI
        </h1>
        <Canvas camera={{ position: [0, 0, 8], fov: 45 }} style={{ width: '100%', height: '100%' }}>
          <color attach="background" args={['#050505']} />
          <ambientLight intensity={0.2} />
          <directionalLight position={[5, 5, 5]} intensity={2} color="#CCFF00" />
          <directionalLight position={[-5, -5, 5]} intensity={1} color="#E2E8F0" />
          <CoreMonolith />
          
          <EffectComposer>
            <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.5} />
            <Noise opacity={0.05} />
            <Vignette eskil={false} offset={0.1} darkness={1.1} />
          </EffectComposer>
        </Canvas>
      </div>

      <GlitchForm />
    </div>
  );
};
