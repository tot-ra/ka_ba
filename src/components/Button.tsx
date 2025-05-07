import React from 'react';
import styles from './Button.module.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  ...props
}) => {
  const buttonClassName = `${styles.button} ${styles[variant]}`;

  return (
    <button className={buttonClassName} onClick={onClick} {...props}>
      {children}
    </button>
  );
};

export default Button;
