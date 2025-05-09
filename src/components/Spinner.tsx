import React from 'react';
import styles from './Spinner.module.css';

interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
  className?: string;
}

const Spinner: React.FC<SpinnerProps> = ({ 
  size = 'medium', 
  color = '#3498db',
  className = '' 
}) => {
  const sizeClass = styles[size] || '';
  
  return (
    <div 
      className={`${styles.spinner} ${sizeClass} ${className}`}
      style={{ borderTopColor: color }}
    />
  );
};

export default Spinner;