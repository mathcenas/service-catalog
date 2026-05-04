import { SpecField, getFieldsForType } from '../lib/serviceFields';

type Props = {
  typeName: string | undefined;
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
};

export function DynamicServiceFields({ typeName, values, onChange }: Props) {
  const fields = getFieldsForType(typeName);
  if (!typeName) {
    return (
      <div className="text-sm text-gray-500 italic">
        Select a service type above to see its specific fields.
      </div>
    );
  }
  if (fields.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        No type-specific fields defined for "{typeName}".
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {fields.map(field => (
        <FieldInput key={field.key} field={field} value={values[field.key]} onChange={onChange} />
      ))}
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: SpecField; value: any; onChange: (k: string, v: any) => void }) {
  const wrapperClass = field.colSpan === 2 ? 'md:col-span-2' : '';
  const baseInput = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';

  if (field.kind === 'boolean') {
    return (
      <div className={wrapperClass}>
        <label className="flex items-center gap-2 cursor-pointer pt-7">
          <input
            type="checkbox"
            checked={!!value}
            onChange={e => onChange(field.key, e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700">{field.label}</span>
        </label>
      </div>
    );
  }

  if (field.kind === 'select') {
    return (
      <div className={wrapperClass}>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">{field.label}</label>
        <select value={value || ''} onChange={e => onChange(field.key, e.target.value)} className={baseInput}>
          <option value="">Select...</option>
          {field.options?.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  const inputType = field.kind === 'number' ? 'number' : field.kind === 'url' ? 'url' : 'text';

  return (
    <div className={wrapperClass}>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{field.label}</label>
      <input
        type={inputType}
        value={value ?? ''}
        onChange={e => onChange(field.key, e.target.value)}
        className={baseInput}
        placeholder={field.placeholder}
      />
    </div>
  );
}
