import type { FormFieldProps } from './FormField'

/** Compile-time guard: FormFieldProps must expose BoxProps members like `children`. */
export type FormFieldPropsIncludesChildren = FormFieldProps['children']
