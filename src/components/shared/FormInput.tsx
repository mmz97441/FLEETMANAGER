import React, { forwardRef, useId } from 'react';
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
  const generatedId = useId();
  const fieldId = props.id || generatedId;
  const helpId = `${fieldId}-help`;
  const describedBy = [props['aria-describedby'], (error || hint) ? helpId : undefined].filter(Boolean).join(' ') || undefined;

  const sizeClasses = {
    sm: { wrapper: 'text-sm', input: 'min-h-11 py-2 px-3 text-base sm:text-sm', icon: 14, label: 'text-sm' },
    md: { wrapper: 'text-sm', input: 'min-h-11 py-2.5 sm:py-3 px-4 text-base sm:text-sm', icon: 18, label: 'text-sm' },
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
        <label htmlFor={fieldId} className={`block ${s.label} font-semibold text-slate-700 mb-1.5 ml-0.5`}>
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
          id={fieldId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
          className={`
            w-full ${s.input} ${Icon ? 'pl-10' : ''}
            ${variantClasses[variant]}
            rounded-lg font-normal text-slate-900
            placeholder:text-slate-500
            focus:ring-2 focus:ring-brand-500 focus:border-brand-500
            outline-none transition-colors
            disabled:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70
            ${error ? 'border-red-500 focus:ring-red-500' : ''}
            ${className}
          `}
        />
      </div>
      {error && <p id={helpId} role="alert" className="text-red-700 text-sm mt-1 ml-1">{error}</p>}
      {hint && !error && <p id={helpId} className="text-slate-600 text-sm mt-1 ml-1">{hint}</p>}
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
  const generatedId = useId();
  const fieldId = props.id || generatedId;
  const helpId = `${fieldId}-help`;
  const describedBy = [props['aria-describedby'], (error || hint) ? helpId : undefined].filter(Boolean).join(' ') || undefined;

  const sizeClasses = {
    sm: { input: 'min-h-11 py-2 px-3 text-base sm:text-sm', label: 'text-sm' },
    md: { input: 'min-h-11 py-2.5 px-4 text-base sm:text-sm', label: 'text-sm' },
    lg: { input: 'py-3 px-5 text-base', label: 'text-sm' }
  };

  const s = sizeClasses[size];

  return (
    <div>
      {label && (
        <label htmlFor={fieldId} className={`block ${s.label} font-semibold text-slate-700 mb-1.5 ml-0.5`}>
          {label}
          {props.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        {...props}
        id={fieldId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={`
          w-full ${s.input}
          bg-white border border-slate-300 hover:border-slate-400
          rounded-lg font-normal text-slate-900
          placeholder:text-slate-500
          focus:ring-2 focus:ring-brand-500 focus:border-brand-500
          outline-none transition-colors resize-none
          disabled:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70
          ${error ? 'border-red-500 focus:ring-red-500' : ''}
          ${className}
        `}
      />
      {error && <p id={helpId} role="alert" className="text-red-700 text-sm mt-1 ml-1">{error}</p>}
      {hint && !error && <p id={helpId} className="text-slate-600 text-sm mt-1 ml-1">{hint}</p>}
    </div>
  );
});

FormTextarea.displayName = 'FormTextarea';

// === SELECT ===
export interface FormSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
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
  const generatedId = useId();
  const fieldId = props.id || generatedId;
  const helpId = `${fieldId}-help`;
  const describedBy = [props['aria-describedby'], (error || hint) ? helpId : undefined].filter(Boolean).join(' ') || undefined;

  const sizeClasses = {
    sm: { input: 'min-h-11 py-2 px-3 text-base sm:text-sm', icon: 14, label: 'text-sm' },
    md: { input: 'min-h-11 py-2.5 sm:py-3 px-4 text-base sm:text-sm', icon: 18, label: 'text-sm' },
    lg: { input: 'py-3.5 px-5 text-base', icon: 20, label: 'text-sm' }
  };

  const s = sizeClasses[size];

  return (
    <div>
      {label && (
        <label htmlFor={fieldId} className={`block ${s.label} font-semibold text-slate-700 mb-1.5 ml-0.5`}>
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
          id={fieldId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
          className={`
            w-full ${s.input} ${Icon ? 'pl-10' : ''} pr-10
            bg-white border border-slate-300 hover:border-slate-400
            rounded-lg font-normal text-slate-900
            focus:ring-2 focus:ring-brand-500 focus:border-brand-500
            outline-none transition-colors appearance-none
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
      {error && <p id={helpId} role="alert" className="text-red-700 text-sm mt-1 ml-1">{error}</p>}
      {hint && !error && <p id={helpId} className="text-slate-600 text-sm mt-1 ml-1">{hint}</p>}
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
  const generatedId = useId();
  const fieldId = props.id || generatedId;
  const helpId = `${fieldId}-help`;
  const describedBy = [props['aria-describedby'], (error || description) ? helpId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label className={`flex min-h-11 items-center gap-3 cursor-pointer ${className}`}>
        <input
          ref={ref}
          type="checkbox"
          {...props}
          id={fieldId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
          className="shrink-0 w-5 h-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
        />
        <div>
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {description && !error && (
            <p id={helpId} className="text-sm text-slate-600 mt-0.5">{description}</p>
          )}
        </div>
      </label>
      {error && <p id={helpId} role="alert" className="text-red-700 text-sm mt-1 ml-8">{error}</p>}
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
    sm: 'ui-button-sm',
    md: '',
    lg: 'ui-button-lg'
  };

  const variantClasses = {
    primary: 'ui-button-primary',
    secondary: 'ui-button-secondary',
    danger: 'ui-button-danger',
    success: 'ui-button-primary',
    ghost: 'ui-button-ghost'
  };

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 20 : 18;

  return (
    <button
      ref={ref}
      {...props}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`
        ${sizeClasses[size]}
        ${variantClasses[variant]}
        ${fullWidth ? 'w-full' : ''}
        ui-button
        ${className}
      `}
    >
      {loading && <svg aria-hidden="true" className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5z"/></svg>}
      {!loading && Icon && iconPosition === 'left' && <Icon aria-hidden="true" size={iconSize} />}
      {children}
      {!loading && Icon && iconPosition === 'right' && <Icon aria-hidden="true" size={iconSize} />}

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
