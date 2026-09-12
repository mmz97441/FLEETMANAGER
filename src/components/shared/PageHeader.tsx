import React from 'react';

export interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export default function PageHeader({ title, description, actions, children, className = '' }: PageHeaderProps) {
  return <header className={`ui-page-header ${className}`}>
    <div className="min-w-0 w-full sm:w-auto sm:flex-1">
      <h1 className="ui-page-title">{title}</h1>
      {description && <div className="ui-page-description">{description}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    {children && <div className="w-full min-w-0">{children}</div>}
  </header>;
}
