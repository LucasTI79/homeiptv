import { useEffect } from 'react';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

interface GuideTourProps {
  steps: DriveStep[];
  tourKey: string; // Used to prevent showing the tour multiple times
  startDelay?: number;
}

export function GuideTour({ steps, tourKey, startDelay = 500 }: GuideTourProps) {
  useEffect(() => {
    const hasSeen = localStorage.getItem(`tour_${tourKey}`);
    if (hasSeen) return;

    const tour = driver({
      showProgress: true,
      animate: true,
      steps,
      onDestroyStarted: () => {
        if (!tour.hasNextStep() || confirm("Are you sure you want to skip the rest of the tour?")) {
          localStorage.setItem(`tour_${tourKey}`, 'true');
          tour.destroy();
        }
      },
    });

    const timer = setTimeout(() => {
      tour.drive();
    }, startDelay);

    return () => {
      clearTimeout(timer);
      tour.destroy(); // cleanup if unmounted
    };
  }, [steps, tourKey, startDelay]);

  return null;
}
