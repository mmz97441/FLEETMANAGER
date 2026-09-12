/**
 * Composants partagés - Exports centralisés
 * 
 * Usage:
 * import { Modal, ConfirmModal, StatCard, FormInput } from './shared';
 */

// Layout & Containers
export { default as Modal } from './Modal';
export type { ModalProps, ModalSize } from './Modal';
export { default as PageHeader } from './PageHeader';

export { default as ConfirmModal } from './ConfirmModal';
export type { ConfirmModalProps, ConfirmType } from './ConfirmModal';

// Data Display
export { default as StatCard } from './StatCard';
export { default as Badge } from './Badge';
export { default as EmptyState } from './EmptyState';
export { default as DataTable } from './DataTable';

// Form Elements
export { FormInput, FormSelect, FormTextarea, FormCheckbox, Button } from './FormInput';
