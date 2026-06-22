import { useRef } from "react"
import { Calendar } from "lucide-react"
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form"
import { Input } from "../ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { formatUSPhoneNumber, handleUSPhoneInputChange } from "@/utils/formatPhoneNumber"
import { formatUSDateMmDdYy, handleUSDateInputChange, parseUSDateMmDdYyToIso } from "@/utils/formatUSDate"

function openNativeDatePicker(input: HTMLInputElement | null) {
    if (!input) return
    if (typeof input.showPicker === "function") {
        try {
            input.showPicker()
            return
        } catch {
            /* showPicker may throw outside a user gesture */
        }
    }
    input.focus({ preventScroll: true })
    input.click()
}


// Text Field Component
type BaseFieldProps<T extends FieldValues> = {
    name: Path<T>
    label: string
    required?: boolean
    labelClassName?: string
    control: Control<T>
}

export const TextField = <T extends FieldValues>({
    name,
    label,
    placeholder,
    required = false,
    disabled = false,
    control,
    labelClassName,
}: BaseFieldProps<T> & {
    placeholder?: string
    disabled?: boolean
}) => (
    <div className="space-y-1.5 flex flex-col">
        <label className={`text-sm font-[400] font-roboto ${labelClassName || 'text-foreground'}`}>
            {label}{required && <span className="text-red-500">*</span>}
        </label>
        <Controller
            control={control}
            name={name}
            render={({ field, fieldState }) => (
                <>
                    <Input
                        {...field}
                        type="text"
                        value={field.value ?? ''}
                        disabled={disabled}
                        aria-invalid={!!fieldState.error}
                        placeholder={placeholder}
                        className="w-full rounded-[5px] bg-background border border-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-100"
                    />
                    {fieldState.error && (
                        <p className="text-[13px] text-red-500 mt-1">{fieldState.error.message}</p>
                    )}
                </>
            )}
        />
    </div>
)

// Email Field Component
export const EmailField = <T extends FieldValues>({
    name,
    label,
    placeholder,
    required = false,
    disabled = false,
    control,
    labelClassName,
}: BaseFieldProps<T> & {
    placeholder?: string
    disabled?: boolean
}) => (
    <div className="space-y-1.5 flex flex-col">
        <label className={`text-sm font-[400] font-roboto ${labelClassName || 'text-foreground'}`}>{label}{required && <span className="text-red-500">*</span>}</label>
        <Controller
            control={control}
            name={name}
            render={({ field, fieldState }) => (
                <>
                    <Input
                        {...field}
                        type="email"
                        value={field.value ?? ''}
                        disabled={disabled}
                        aria-invalid={!!fieldState.error}
                        placeholder={placeholder}
                        className="w-full rounded-[5px] bg-background border border-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-100"
                    />
                    {fieldState.error && (
                        <p className="text-[13px] text-red-500 mt-1">{fieldState.error.message}</p>
                    )}
                </>
            )}
        />
    </div>
)

// Number Field Component
export const NumberField = <T extends FieldValues>({
    name,
    label,
    placeholder,
    min,
    max,
    prefix,
    suffix,
    required = false,
    control,
    labelClassName,
}: BaseFieldProps<T> & {
    placeholder?: string
    min?: number
    max?: number
    prefix?: string
    suffix?: string
}) => (
    <div className="space-y-1.5 flex flex-col">
        <label className={`text-sm font-[400] font-roboto ${labelClassName || 'text-foreground'}`}>{label}{required && <span className="text-red-500">*</span>}</label>
        <Controller
            control={control}
            name={name}
            render={({ field, fieldState }) => (
                <>
                    <div className="relative">
                        {prefix && (
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                {prefix}
                            </span>
                        )}
                        <Input
                            {...field}
                            type="number"
                            value={field.value ?? ''}
                            onChange={(e) => {
                                const value = e.target.value
                                field.onChange(value === '' ? '' : Number(value))
                            }}
                            min={min}
                            max={max}
                            aria-invalid={!!fieldState.error}
                            placeholder={placeholder}
                            className={`w-full rounded-[5px] bg-background border border-[#E5E7EB] focus-visible:ring-[3px] ${prefix ? 'pl-7' : ''} ${suffix ? 'pr-8' : ''}`}
                        />
                        {suffix && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                                {suffix}
                            </span>
                        )}
                    </div>
                    {fieldState.error && (
                        <p className="text-[13px] text-red-500 mt-1">{fieldState.error.message}</p>
                    )}
                </>
            )}
        />
    </div>
)

// Date Field Component
export const DateField = <T extends FieldValues>({
    name,
    label,
    required = false,
    disabled = false,
    control,
    labelClassName,
    usFormat = false,
    placeholder,
}: BaseFieldProps<T> & {
    usFormat?: boolean
    placeholder?: string
    disabled?: boolean
}) => {
    const datePickerRef = useRef<HTMLInputElement>(null)

    return (
        <div className="space-y-1.5 flex flex-col">
            <label className={`text-sm font-[400] font-roboto ${labelClassName || 'text-foreground'}`}>{label}{required && <span className="text-red-500">*</span>}</label>
            <Controller
                control={control}
                name={name}
                render={({ field, fieldState }) => {
                    const displayValue = usFormat
                        ? formatUSDateMmDdYy(field.value)
                        : field.value
                            ? (typeof field.value === 'string' && field.value.includes('T')
                                ? field.value.split('T')[0]
                                : field.value)
                            : ''
                    const isoValue = usFormat
                        ? (parseUSDateMmDdYyToIso(displayValue) || '')
                        : displayValue

                    return (
                        <>
                            <div className="relative">
                                <Input
                                    {...field}
                                    type={usFormat ? 'text' : 'date'}
                                    value={displayValue}
                                    onChange={
                                        usFormat
                                            ? (e) => handleUSDateInputChange(e, field.onChange)
                                            : field.onChange
                                    }
                                    disabled={disabled}
                                    inputMode={usFormat ? 'numeric' : undefined}
                                    aria-invalid={!!fieldState.error}
                                    placeholder={usFormat ? (placeholder || 'mm-dd-yyyy') : placeholder}
                                    className={`w-full rounded-[5px] bg-background border border-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-100 ${usFormat ? 'pr-9' : ''}`}
                                />
                                {usFormat && (
                                    <>
                                        <input
                                            ref={datePickerRef}
                                            type="date"
                                            tabIndex={-1}
                                            aria-hidden
                                            disabled={disabled}
                                            className="sr-only"
                                            value={isoValue}
                                            onChange={(e) => {
                                                const value = e.target.value
                                                if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                                                    field.onChange(formatUSDateMmDdYy(value))
                                                }
                                            }}
                                        />
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => openNativeDatePicker(datePickerRef.current)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                            aria-label={`Open calendar for ${label}`}
                                        >
                                            <Calendar className="size-4 shrink-0" />
                                        </button>
                                    </>
                                )}
                            </div>
                            {fieldState.error && (
                                <p className="text-[13px] text-red-500 mt-1">{fieldState.error.message}</p>
                            )}
                        </>
                    )
                }}
            />
        </div>
    )
}

// Phone Field Component
export const PhoneField = <T extends FieldValues>({
    name,
    label,
    placeholder,
    required = false,
    disabled = false,
    control,
    labelClassName,
}: BaseFieldProps<T> & {
    placeholder?: string
    disabled?: boolean
}) => (
    <div className="space-y-1.5 flex flex-col">
        <label className={`text-sm font-[400] font-roboto ${labelClassName || 'text-foreground'}`}>{label}{required && <span className="text-red-500">*</span>}</label>
        <Controller
            control={control}
            name={name}
            render={({ field, fieldState }) => (
                <>
                    <Input
                        {...field}
                        type="tel"
                        value={formatUSPhoneNumber(field.value)}
                        onChange={(e) => handleUSPhoneInputChange(e, field.onChange)}
                        disabled={disabled}
                        aria-invalid={!!fieldState.error}
                        placeholder={placeholder || '(XXX) XXX-XXXX'}
                        inputMode="numeric"
                        className="w-full rounded-[5px] bg-background border border-[#E5E7EB] disabled:cursor-not-allowed disabled:opacity-100"
                    />
                    {fieldState.error && (
                        <p className="text-[13px] text-red-500 mt-1">{fieldState.error.message}</p>
                    )}
                </>
            )}
        />
    </div>
)

// Select Field Component
export const SelectField = <T extends FieldValues>({
    name,
    label,
    options,
    placeholder,
    required = false,
    control,
    labelClassName,
}: BaseFieldProps<T> & {
    options: { value: string; label: string }[]
    placeholder?: string
}) => (
    <div className="space-y-1.5 flex flex-col">
        <label className={`text-sm font-[400] font-roboto ${labelClassName || 'text-foreground'}`}>{label}{required && <span className="text-red-500">*</span>}</label>
        <Controller
            control={control}
            name={name}
            render={({ field, fieldState }) => (
                <>
                    <Select
                        onValueChange={field.onChange}
                        value={field.value || ''}
                    >
                        <SelectTrigger className="w-full h-10 rounded-md border border-input bg-background text-foreground focus-visible:ring-[3px]">
                            <SelectValue placeholder={placeholder || 'Select...'} />
                        </SelectTrigger>
                        <SelectContent>
                            {options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {fieldState.error && (
                        <p className="text-[13px] text-red-500 mt-1">{fieldState.error.message}</p>
                    )}
                </>
            )}
        />
    </div>
)