import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Box } from '@react-three/drei';

const ChartSurface = () => {
  const groupRef = useRef<any>(null);
  
  // A simple representation of a 3D payoff chart surface using a grid of boxes
  // to give a professional volumetric look.
  return (
    <group ref={groupRef} rotation={[-Math.PI / 4, Math.PI / 4, 0]}>
      {Array.from({ length: 15 }).map((_, i) =>
        Array.from({ length: 15 }).map((_, j) => {
          const x = i - 7.5;
          const z = j - 7.5;
          // Simple straddle-like payoff function (V-shape)
          const payoff = Math.abs(x) * 0.6 - 2;
          const height = Math.max(0.1, payoff + 3);
          const color = payoff > 0 ? '#F59E0B' : '#ef4444'; // Gold for profit, Red for loss
          
          return (
            <Box
              key={`${i}-${j}`}
              args={[0.9, height, 0.9]}
              position={[x, height / 2 - 2, z]}
            >
              <meshStandardMaterial color={color} roughness={0.1} metalness={0.8} />
            </Box>
          );
        })
      )}
    </group>
  );
};

export const PayoffChart3D = () => {
  return (
    <div className="chart-container">
      <Canvas camera={{ position: [0, 8, 12], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <spotLight position={[15, 20, 10]} angle={0.2} penumbra={1} intensity={1.5} />
        <pointLight position={[-10, -10, -10]} intensity={0.5} />
        <ChartSurface />
        <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={1.5} maxPolarAngle={Math.PI / 2.5} />
      </Canvas>
    </div>
  );
};
