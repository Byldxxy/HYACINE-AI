/**
 * 管理面板的基础控件集合。
 *
 * tabs 应优先复用这些组件，以保持 label、hint、开关可访问性、按钮图标和 CSS 类一致。
 * 这些组件保持无业务状态：值和事件均由 ConfigPanel/useConfig 向下传递。
 */
import React, { useLayoutEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import PinkSelect from './PinkSelect';

export const TabContent = ({ children }) => {
    const reducedMotion = useReducedMotion();
    return (
    <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
        transition={{ duration: reducedMotion ? 0 : 0.16 }}
        className="space-y-5"
    >
        {children}
    </motion.div>
    );
};

export const TabButton = ({ active, id, icon: Icon, label, onClick }) => (
    <button
        type="button"
        onClick={() => onClick(id)}
        className={`nav-item ${active === id ? 'nav-item-active' : ''}`}
    >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
    </button>
);

export const PageHeader = ({ icon: Icon, title, description, actions }) => (
    <div className="page-header">
        <div className="min-w-0">
            <div className="flex items-center gap-2.5">
                {Icon && <Icon className="h-5 w-5 text-pink-500" />}
                <h1>{title}</h1>
            </div>
            {description && <p>{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
);

export const Section = ({ title, description, action, children, className = '' }) => (
    <section className={`ui-section ${className}`}>
        {(title || action) && (
            <div className="section-heading">
                <div>
                    {title && <h2>{title}</h2>}
                    {description && <p>{description}</p>}
                </div>
                {action}
            </div>
        )}
        <div className={title || action ? 'section-body' : ''}>{children}</div>
    </section>
);

export const InputGroup = ({ label, hint, type = 'text', placeholder, value, onChange, onFocus, disabled }) => (
    <label className="field-group">
        <span className="field-label">{label}</span>
        <input
            type={type}
            placeholder={placeholder}
            className="ui-input"
            value={value ?? ''}
            onChange={onChange}
            onFocus={onFocus}
            disabled={disabled}
        />
        {hint && <span className="field-hint">{hint}</span>}
    </label>
);

export const GrowingTextarea = ({ value, className = '', rows = 3, ...props }) => {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const node = ref.current;
        let width = -1;
        const resize = () => {
            if (!node.clientWidth) return;
            node.style.height = 'auto';
            node.style.height = `${node.scrollHeight + 2}px`;
        };
        resize();
        const observer = new ResizeObserver(() => {
            if (node.clientWidth === width) return;
            width = node.clientWidth;
            resize();
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [value, rows]);
    return <textarea {...props} ref={ref} value={value ?? ''} rows={rows} className={`ui-textarea growing-textarea ${className}`} />;
};

export const TextArea = ({ label, hint, ...props }) => (
    <label className="field-group">
        <span className="field-label">{label}</span>
        <GrowingTextarea {...props} />
        {hint && <span className="field-hint">{hint}</span>}
    </label>
);

export const PageTabs = ({ value, onChange, options, label }) => (
    <nav className="page-sections" aria-label={label}>
        {options.map(option => <button key={option.value} type="button" aria-current={value === option.value ? 'page' : undefined} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </nav>
);

export const PromptBlock = ({ title, value, onChange, height = 'min-h-32' }) => (
    <TextArea label={title} value={value} onChange={(event) => onChange(event.target.value)} className={height} />
);

export const Toggle = ({ checked, onChange, label, description, disabled = false }) => (
    <div className={`toggle-row ${disabled ? 'opacity-55' : ''}`}>
        <div className="min-w-0 pr-4">
            <div className="toggle-label">{label}</div>
            {description && <div className="toggle-description">{description}</div>}
        </div>
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`ui-switch ${checked ? 'ui-switch-on' : ''}`}
        >
            <span />
        </button>
    </div>
);

export const RangeField = ({ label, value, suffix = '', ...inputProps }) => (
    <label className="field-group">
        <span className="flex items-center justify-between gap-3">
            <span className="field-label">{label}</span>
            <span className="value-badge">{value}{suffix}</span>
        </span>
        <input type="range" value={value} className="ui-range" {...inputProps} />
    </label>
);

const buttonStyles = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    danger: 'btn-danger',
    ghost: 'btn-ghost',
};
// Keep complete class names visible to Tailwind's production content scanner.
const buttonSizes = { sm: 'btn-sm', md: 'btn-md' };

export const Button = ({ icon: Icon, children, variant = 'secondary', size = 'md', className = '', ...props }) => (
    <button type="button" className={`ui-button ${buttonStyles[variant]} ${buttonSizes[size] || buttonSizes.md} ${Icon ? 'btn-with-icon' : ''} ${className}`} {...props}>
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="button-label">{children}</span>
    </button>
);

export const IconButton = ({ icon: Icon, label, variant = 'ghost', className = '', ...props }) => (
    <button
        type="button"
        className={`icon-button ${buttonStyles[variant]} ${className}`}
        title={label}
        aria-label={label}
        {...props}
    >
        <Icon className="h-4 w-4" />
    </button>
);

export const SelectField = ({ label, value, onChange, children }) => {
    const options = React.Children.toArray(children).filter(React.isValidElement).map(option => ({
        value: String(option.props.value ?? option.props.children),
        label: option.props.children,
    }));
    return <div className="field-group">
        <span className="field-label">{label}</span>
        <PinkSelect label={label} value={String(value ?? '')} options={options} onChange={next => onChange?.({ target: { value: next } })} />
    </div>;
};
