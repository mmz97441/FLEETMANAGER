import React, { forwardRef } from 'react';
import { LucideIcon } from 'lucide-react';

// === INPUT ===
export interface FormInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  icon?: LucideIcon;
  error?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'filled';
}

export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(({
  label,
  icon: Icon,
  error,
  hint,
  size = 'md',
  variant = 'default',
  className = '',
  ...props
}, ref) => {
  const sizeClasses = {
    sm: { wrapper: 'text-xs', input: 'py-2 px-3 text-sm', icon: 14, label: 'text-xs' },
    md: { wrapper: 'text-sm', input: 'py-2.5 sm:py-3 px-4 text-sm', icon: 18, label: 'text-xs sm:text-sm' },
    lg: { wrapper: 'text-base', input: 'py-3.5 px-5 text-base', icon: 20, label: 'text-sm' }
  };

  const s = sizeClasses[size];
  
  const variantClasses = {
    default: 'bg-white border border-slate-300 hover:border-slate-400',
    filled: 'bg-slate-100 border border-transparent hover:bg-slate-200'
  };

  return (
    <div className={s.wrapper}>
      {label && (
        <label className={`block ${s.label} font-bold text-slate-700 mb-1.5 ml-0.5`}>
          {label}
          {props.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon size={s.icon} />
          </div>
        )}
        <input
          ref={ref}
          {...props}
          className={`
            w-full ${s.input} ${Icon ? 'pl-10' : ''} 
            ${variantClasses[variant]}
            rounded-xl font-medium text-slate-900 
            placeholder:text-slate-400 
            focus:ring-2 focus:ring-brand-500 focus:border-brand-500 
            outline-none transition-all shadow-sm
            disabled:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70
            ${error ? 'border-red-500 focus:ring-red-500' : ''}
            ${className}
          `}
        />
      </div>
      {error && <p className="text-red-500 text-xs mt-1 ml-1">{error}</p>}
      {hint && !error && <p className="text-slate-400 text-xs mt-1 ml-1">{hint}</p>}
    </div>
  );
});

FormInput.displayName = 'FormInput';

// === TEXTAREA ===
export interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const FormTextarea = forwardRef<HTMLTextAreaElement, FormTextareaProps>(({
  label,
  error,
  hint,
  size = 'md',
  className = '',
  ...props
}, ref) => {
  const sizeClasses = {
    sm: { input: 'py-2 px-3 text-sm', label: 'text-xs' },
    md: { input: 'py-2.5 px-4 text-sm', label: 'text-xs sm:text-sm' },
    lg: { input: 'py-3 px-5 text-base', label: 'text-sm' }
  };

  const s = sizeClasses[size];

  return (
    <div>
      {label && (
        <label className={`block ${s.label} font-bold text-slate-700 mb-1.5 ml-0.5`}>
          {label}
          {props.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        {...props}
        className={`
          w-full ${s.input}
          bg-white border border-slate-300 hover:border-slate-400
          rounded-xl font-medium text-slate-900 
          placeholder:text-slate-400 
          focus:ring-2 focus:ring-brand-500 focus:border-brand-500 
          outline-none transition-all shadow-sm resize-none
          disabled:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70
          ${error ? 'border-red-500 focus:ring-red-500' : ''}
          ${className}
        `}
      />
      {error && <p className="text-red-500 text-xs mt-1 ml-1">{error}</p>}
      {hint && !error && <p className="text-slate-400 text-xs mt-1 ml-1">{hint}</p>}
    </div>
  );
});

FormTextarea.displayName = 'FormTextarea';

// === SELECT ===
export interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  icon?: LucideIcon;
  error?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(({
  label,
  icon: Icon,
  error,
  hint,
  size = 'md',
  options,
  placeholder,
  className = '',
  ...props
}, ref) => {
  const sizeClasses = {
    sm: { input: 'py-2 px-3 text-sm', icon: 14, label: 'text-xs' },
    md: { input: 'py-2.5 sm:py-3 px-4 text-sm', icon: 18, label: 'text-xs sm:text-sm' },
    lg: { input: 'py-3.5 px-5 text-base', icon: 20, label: 'text-sm' }
  };

  const s = sizeClasses[size];

  return (
    <div>
      {label && (
        <label className={`block ${s.label} font-bold text-slate-700 mb-1.5 ml-0.5`}>
          {label}
          {props.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <Icon size={s.icon} />
          </div>
        )}
        <select
          ref={ref}
          {...props}
          className={`
            w-full ${s.input} ${Icon ? 'pl-10' : ''} pr-10
            bg-white border border-slate-300 hover:border-slate-400
            rounded-xl font-medium text-slate-900 
            focus:ring-2 focus:ring-brand-500 focus:border-brand-500 
            outline-none transition-all shadow-sm appearance-none
            disabled:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70
            ${error ? 'border-red-500 focus:ring-red-500' : ''}
            ${className}
          `}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {/* Chevron */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {error && <p className="text-red-500 text-xs mt-1 ml-1">{error}</p>}
      {hint && !error && <p className="text-slate-400 text-xs mt-1 ml-1">{hint}</p>}
    </div>
  );
});

FormSelect.displayName = 'FormSelect';

// === CHECKBOX ===
export interface FormCheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  description?: string;
  error?: string;
}

export const FormCheckbox = forwardRef<HTMLInputElement, FormCheckboxProps>(({
  label,
  description,
  error,
  className = '',
  ...props
}, ref) => {
  return (
    <div>
      <label className={`flex items-start gap-3 cursor-pointer ${className}`}>
        <input
          ref={ref}
          type="checkbox"
          {...props}
          className="mt-0.5 w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
        />
        <div>
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {description && (
            <p className="text-xs text-slate-500 mt-0.5">{description}</p>
          )}
        </div>
      </label>
      {error && <p className="text-red-500 text-xs mt-1 ml-7">{error}</p>}
    </div>
  );
});

FormCheckbox.displayName = 'FormCheckbox';

// === BUTTON ===
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconPosition = 'left',
  loading = false,
  fullWidth = false,
  children,
  className = '',
  disabled,
  ...props
}, ref) => {
  const sizeClasses = {
    sm: 'py-2 px-3 text-xs gap-1.5',
    md: 'py-2.5 sm:py-3 px-4 text-sm gap-2',
    lg: 'py-3.5 px-6 text-base gap-2'
  };

  const variantClasses = {
    primary: 'bg-brand-600 hover:bg-brand-700 text-white shadow-lg hover:shadow-xl',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-lg',
    success: 'bg-green-600 hover:bg-green-700 text-white shadow-lg',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-600'
  };

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 20 : 18;

  return (
    <button
      ref={ref}
      {...props}
      disabled={disabled || loading}
      className={`
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${fullWidth ? 'w-full' : ''}
        rounded-xl font-bold flex items-center justify-center
        transition-all transform hover:-translate-y-0.5 active:translate-y-0
        disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
        ${className}
      `}
    >
      {loading ? (
        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : (
        <>
          {Icon && iconPosition === 'left' && <Icon size={iconSize} />}
          {children}
          {Icon && iconPosition === 'right' && <Icon size={iconSize} />}
        </>
      )}
    </button>
  );
});

Button.displayName = 'Button';

// === FORM GROUP ===
interface FormGroupProps {
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const FormGroup: React.FC<FormGroupProps> = ({
  children,
  columns = 1,
  gap = 'md',
  className = ''
}) => {
  const columnClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
  };

  const gapClasses = {
    sm: 'gap-2',
    md: 'gap-3 sm:gap-4',
    lg: 'gap-4 sm:gap-6'
  };

  return (
    <div className={`grid ${columnClasses[columns]} ${gapClasses[gap]} ${className}`}>
      {children}
    </div>
  );
};

// Export default pour import groupé
export default {
  Input: FormInput,
  Textarea: FormTextarea,
  Select: FormSelect,
  Checkbox: FormCheckbox,
  Button,
  Group: FormGroup
};
