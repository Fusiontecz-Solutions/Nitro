import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { useForm, useFieldArray, useWatch, type SubmitHandler } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Button } from '@/components/ui/button'
import { useMemo, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router'
import { Card, CardContent } from '@/components/ui/card'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '@/redux/store'
import { createClient, updateClient, getClientByClientId } from '@/redux/actions/clientActions'
import { resetCreateClient, resetUpdateClient, clearClientDetail } from '@/redux/slices/clientSlice'
import { toast } from 'react-toastify'
import { DateField, EmailField, NumberField, PhoneField, SelectField, TextField } from '@/components/inputFields/InputFields'
import { useTheme } from '@/context/ThemeContext'
import type { OwnerDetail } from '@/types/clientTypes'
import { formatUSDateMmDdYy, parseUSDateMmDdYyToIso } from '@/utils/formatUSDate'

// Address type (nested)
type Address = {
	address1: string
	address2: string
	city: string
	state: string
	zipCode: string
}

// Business Profile type (matches backend schema)
type BusinessProfile = {
	name: string
	email: string
	number: string
	website: string
	incorporationDate: string // Date as string for form
	incorporationState: string
	businessEntityType: string
	einNumber: string
	monthlyRevenue: number | string
	address: Address
}

export type FormValues = {
	business: BusinessProfile
	owners: OwnerDetail[]
}

const emptyAddress: Address = {
	address1: '',
	address2: '',
	city: '',
	state: '',
	zipCode: '',
}

const emptyOwner: OwnerDetail = {
	firstName: '',
	middleName: '',
	lastName: '',
	email: '',
	mobileNumber: '',
	dateOfBirth: '',
	ssn: '',
	ficoScore: '',
	ownershipStartDate: '',
	ownershipPercentage: '',
	address: { ...emptyAddress },
}

// Business entity type options from schema
const businessEntityTypes = [
	{ value: 'LLC', label: 'LLC' },
	{ value: 'Corporation', label: 'Corporation' },
	{ value: 'Partnership', label: 'Partnership' },
	{ value: 'Sole Proprietorship', label: 'Sole Proprietorship' },
	{ value: 'S-Corp', label: 'S-Corp' },
	{ value: 'C-Corp', label: 'C-Corp' },
	{ value: 'Non-Profit', label: 'Non-Profit' },
	{ value: 'Other', label: 'Other' },
]

const defaultFormValues: FormValues = {
	business: {
		name: '',
		email: '',
		number: '',
		website: '',
		incorporationDate: '',
		incorporationState: '',
		businessEntityType: '',
		einNumber: '',
		monthlyRevenue: '',
		address: { ...emptyAddress },
	},
	owners: [{ ...emptyOwner, address: { ...emptyAddress } }],
}

const getOwnerOrdinalLabel = (index: number) => {
	const n = index + 1
	const suffix = n % 10 === 1 && n % 100 !== 11
		? 'st'
		: n % 10 === 2 && n % 100 !== 12
			? 'nd'
			: n % 10 === 3 && n % 100 !== 13
				? 'rd'
				: 'th'
	return `${n}${suffix} Owner`
}

const usDateSchema = yup
	.string()
	.required('Date is required')
	.test('valid-us-date', 'Enter a valid date (mm-dd-yyyy)', (value) => {
		if (!value?.trim()) return false
		return parseUSDateMmDdYyToIso(value) !== null
	})

const toFormDate = (value?: string) => (value ? formatUSDateMmDdYy(value) : '')

const toApiDate = (value?: string) => {
	if (!value?.trim()) return ''
	return parseUSDateMmDdYyToIso(value) || value
}

const ownerDetailSchema = yup.object({
	firstName: yup.string().required('First name is required'),
	middleName: yup.string().optional(),
	lastName: yup.string().required('Last name is required'),
	email: yup.string().email('Enter a valid email').required('Email is required'),
	mobileNumber: yup.string().optional(),
	dateOfBirth: usDateSchema,
	ssn: yup.string().required('Social security number is required'),
	ficoScore: yup.number().min(300, 'Min 300').max(850, 'Max 850').required('FICO score is required').nullable().transform((value, originalValue) => originalValue === '' ? null : value),
	ownershipStartDate: usDateSchema,
	ownershipPercentage: yup.number().min(0, 'Min 0%').max(100, 'Max 100%').required('Ownership percentage is required').nullable().transform((value, originalValue) => originalValue === '' ? null : value),
	address: yup.object({
		address1: yup.string().required('Address 1 is required'),
		address2: yup.string().optional(),
		city: yup.string().required('City is required'),
		state: yup.string().required('State is required'),
		zipCode: yup.string().required('Zip Code is required'),
	}),
})

const isOwnerComplete = (owner?: OwnerDetail) => {
	if (!owner) return false
	return Boolean(
		owner.firstName?.trim() &&
		owner.lastName?.trim() &&
		owner.email?.trim() &&
		owner.dateOfBirth &&
		owner.ssn?.trim() &&
		owner.ficoScore !== '' &&
		owner.ownershipStartDate &&
		owner.ownershipPercentage !== '' &&
		owner.address?.address1?.trim() &&
		owner.address?.city?.trim() &&
		owner.address?.state?.trim() &&
		owner.address?.zipCode?.trim()
	)
}

const CreateClient = () => {
	const navigate = useNavigate()
	const dispatch = useDispatch<AppDispatch>()
	const { clientId } = useParams<{ clientId: string }>()
	const location = useLocation()
	const { resolvedTheme } = useTheme()
	const isDark = resolvedTheme === 'dark'

	// Determine view/edit mode based on URL param and navigation state
	const modeFromState = (location.state as any)?.mode
	const isViewMode = !!clientId && modeFromState === 'view'
	const isEditMode = !!clientId && !isViewMode

	// Redux state selectors
	const { loading: createLoading, success: createSuccess, error: createError } = useSelector(
		(state: RootState) => state.createClient
	)
	const { loading: updateLoading, success: updateSuccess, error: updateError } = useSelector(
		(state: RootState) => state.updateClient
	)
	const {
		loading: fetchLoading,
		data: clientData,
		error: fetchError
	} = useSelector(
		(state: RootState) => state.clientDetail
	)

	const isLoading = isEditMode ? updateLoading : createLoading
	const isPageLoading = (isEditMode || isViewMode) && fetchLoading

	const schema = useMemo(
		() =>
			yup.object({
				business: yup.object({
					name: yup.string().required('Business name is required'),
					email: yup.string().email('Enter a valid email').required('Email is required'),
					number: yup.string().optional(),
					website: yup.string().optional(),
					incorporationDate: usDateSchema,
					incorporationState: yup.string().required('Incorporation state is required'),
					businessEntityType: yup.string().required('Business entity type is required'),
					einNumber: yup.string().required('EIN number is required'),
					monthlyRevenue: yup.number().min(0, 'Must be positive').required('Monthly revenue is required').nullable().transform((value, originalValue) => originalValue === '' ? null : value),
					address: yup.object({
						address1: yup.string().required('Address 1 is required'),
						address2: yup.string().optional(),
						city: yup.string().required('City is required'),
						state: yup.string().required('State is required'),
						zipCode: yup.string().required('Zip Code is required'),
					}),
				}),
				owners: yup.array().of(ownerDetailSchema).min(1, 'At least one owner is required'),
			}),
		[]
	)

	const { control, handleSubmit, reset, formState: { isValid } } = useForm<FormValues>({
		resolver: yupResolver(schema) as any,
		mode: 'all',
		defaultValues: defaultFormValues,
	})

	const { fields, append, remove } = useFieldArray({
		control,
		name: 'owners',
	})

	const watchedOwners = useWatch({ control, name: 'owners' })
	const canAddOwner = isOwnerComplete(watchedOwners?.[0])

	// Prefill form when navigating from Auto-Create Client from PDF
	const prefilledClientData = (location.state as any)?.prefilledClientData as
		| Partial<FormValues & { owner?: OwnerDetail }>
		| undefined

	useEffect(() => {
		if (!isEditMode && prefilledClientData) {
			const prefilledOwners = prefilledClientData.owners?.length
				? prefilledClientData.owners
				: prefilledClientData.owner
					? [prefilledClientData.owner]
					: defaultFormValues.owners

			const merged: FormValues = {
				business: {
					...defaultFormValues.business,
					...(prefilledClientData.business || {}),
					incorporationDate: toFormDate(prefilledClientData.business?.incorporationDate),
					address: {
						...defaultFormValues.business.address,
						...(prefilledClientData.business?.address || {}),
					},
				},
				owners: prefilledOwners.map((owner) => ({
					...emptyOwner,
					...owner,
					dateOfBirth: toFormDate(owner.dateOfBirth),
					ownershipStartDate: toFormDate(owner.ownershipStartDate),
					address: {
						...emptyAddress,
						...(owner.address || {}),
					},
				})),
			}
			reset(merged)
		}
	}, [isEditMode, prefilledClientData, reset])

	// Fetch client data when in edit mode
	useEffect(() => {
		if (clientId) {
			dispatch(getClientByClientId(clientId))
		}
		// Cleanup on unmount
		return () => {
			dispatch(clearClientDetail())
		}
	}, [clientId, dispatch])

	// Reset form values when clientData is fetched
	useEffect(() => {
		if (clientData && (isEditMode || isViewMode)) {
			const ownersFromApi = clientData.owners?.length
				? clientData.owners
				: clientData.owner
					? [clientData.owner]
					: defaultFormValues.owners

			const formData: FormValues = {
				business: {
					name: clientData.business?.name || '',
					email: clientData.business?.email || '',
					number: clientData.business?.number || '',
					website: clientData.business?.website || '',
					incorporationDate: toFormDate(clientData.business?.incorporationDate),
					incorporationState: clientData.business?.incorporationState || '',
					businessEntityType: clientData.business?.businessEntityType || '',
					einNumber: clientData.business?.einNumber || '',
					monthlyRevenue: clientData.business?.monthlyRevenue || '',
					address: {
						address1: clientData.business?.address?.address1 || '',
						address2: clientData.business?.address?.address2 || '',
						city: clientData.business?.address?.city || '',
						state: clientData.business?.address?.state || '',
						zipCode: clientData.business?.address?.zipCode || '',
					},
				},
				owners: ownersFromApi.map((owner) => ({
					firstName: owner.firstName || '',
					middleName: owner.middleName || '',
					lastName: owner.lastName || '',
					email: owner.email || '',
					mobileNumber: owner.mobileNumber || '',
					dateOfBirth: toFormDate(owner.dateOfBirth),
					ssn: owner.ssn || '',
					ficoScore: owner.ficoScore || '',
					ownershipStartDate: toFormDate(owner.ownershipStartDate),
					ownershipPercentage: owner.ownershipPercentage || '',
					address: {
						address1: owner.address?.address1 || '',
						address2: owner.address?.address2 || '',
						city: owner.address?.city || '',
						state: owner.address?.state || '',
						zipCode: owner.address?.zipCode || '',
					},
				})),
			}
			reset(formData)
		}
	}, [clientData, isEditMode, isViewMode, reset])

	// Handle fetch error
	useEffect(() => {
		if (fetchError) {
			toast.error(fetchError)
		}
	}, [fetchError])

	// Handle create success/error
	useEffect(() => {
		if (createSuccess) {
			toast.success('Client created successfully!')
			dispatch(resetCreateClient())
			navigate('/clients')
		}
		if (createError) {
			toast.error(createError)
			dispatch(resetCreateClient())
		}
	}, [createSuccess, createError, dispatch, navigate])

	// Handle update success/error
	useEffect(() => {
		if (updateSuccess) {
			toast.success('Client updated successfully!')
			dispatch(resetUpdateClient())
			navigate('/clients')
		}
		if (updateError) {
			toast.error(updateError)
			dispatch(resetUpdateClient())
		}
	}, [updateSuccess, updateError, dispatch, navigate])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			dispatch(resetCreateClient())
			dispatch(resetUpdateClient())
		}
	}, [dispatch])

	const onSubmit: SubmitHandler<FormValues> = (data) => {
		const payload = {
			business: {
				...data.business,
				incorporationDate: toApiDate(data.business.incorporationDate),
			},
			owners: data.owners.map((owner) => ({
				...owner,
				dateOfBirth: toApiDate(owner.dateOfBirth),
				ownershipStartDate: toApiDate(owner.ownershipStartDate),
			})),
		}

		if (isEditMode && clientData) {
			const id = clientData._id
			if (id) {
				dispatch(updateClient({ id, data: payload }))
			} else {
				toast.error('Client ID not found for update')
			}
		} else {
			dispatch(createClient(payload))
		}
	}

	const handleAddOwner = () => {
		append({ ...emptyOwner, address: { ...emptyAddress } })
	}

	const Section = ({ title, headerAction, children }: { title: string; headerAction?: React.ReactNode; children: React.ReactNode }) => (
		<Card className={`rounded-sm box-border shadow-[0px_4px_20px_0px_#00000005] p-0 border pb-5 ${
			isDark ? 'bg-[#141517] border-[#374151]' : 'border-[#FDFDFD]'
		}`}>
			<CardContent className="space-y-3 p-0">
				<div className={`flex items-center justify-between gap-3 px-6 py-3 ${
					isDark ? 'bg-[#2A2B2F]' : 'bg-[#F9FAFD]'
				}`}>
					<h2 className={`text-base font-[600] font-roboto ${
						isDark ? 'text-white' : 'text-[#374151]'
					}`}>{title}</h2>
					{headerAction}
				</div>
				<div
					className={`px-6 grid grid-cols-1 md:grid-cols-2 gap-4 ${
						isViewMode ? 'pointer-events-none opacity-75' : ''
					}`}
				>
					{children}
				</div>
			</CardContent>
		</Card>
	)

	const labelClassName = isDark ? 'text-white' : 'text-[#374151]'

	// Show loading state while fetching client data in edit mode
	if (isPageLoading) {
		return (
			<div className="min-h-[calc(100vh-64px)] w-full bg-background p-4 md:p-6 lg:p-8 flex items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="h-10 w-10 animate-spin text-primary" />
					<p className="text-muted-foreground">Loading client details...</p>
				</div>
			</div>
		)
	}

	return (
		<div className="min-h-[calc(100vh-64px)] w-full bg-background p-4 md:p-6 lg:p-8">
			<div className="w-full mx-auto">
				<div className="space-y-6">
					{/* Title Card */}
					<Card className={`flex justify-between px-2 py-3 rounded-lg shadow-[0px_4px_20px_0px_#00000005] ${
						isDark ? 'bg-[#141517]' : 'bg-white'
					}`}>
						<CardContent className="flex items-center gap-3 px-0">
							<Button
								onClick={() => navigate('/clients')}
								variant="ghost"
								className="h-10 gap-2 px-0 py-0 bg-card text-muted-foreground hover:bg-accent cursor-pointer"
							>
								<ArrowLeft className={`size-5 ${isDark ? 'text-white' : 'text-[#111827]'}`} />
							</Button>
							<span className={`text-[1.1rem] font-semibold font-roboto ${isDark ? 'text-white' : 'text-[#111827]'}`}>
								{isViewMode ? 'View Client' : isEditMode ? 'Edit Client' : 'Create New Client'}
							</span>
						</CardContent>
					</Card>

					<form onSubmit={isViewMode ? undefined : handleSubmit(onSubmit)} className="space-y-6">
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
							{/* Business Profile Section */}
							<Section title="Business Profile">
								<TextField control={control} name="business.name" label="Business Name" placeholder="Enter business name" labelClassName={labelClassName} required />
								<EmailField control={control} name="business.email" label="Email" placeholder="Enter email address" labelClassName={labelClassName} required />
								<PhoneField control={control} name="business.number" label="Phone Number" placeholder="(XXX) XXX-XXXX" labelClassName={labelClassName} />
								<TextField control={control} name="business.website" label="Website" placeholder="https://example.com" labelClassName={labelClassName} required />
								<DateField control={control} name="business.incorporationDate" label="Incorporation Date" labelClassName={labelClassName} usFormat placeholder="mm-dd-yyyy" required />
								<TextField control={control} name="business.incorporationState" label="Incorporation State" placeholder="e.g., FL, NY" labelClassName={labelClassName} required />
								<SelectField
									control={control}
									name="business.businessEntityType"
									label="Type of Business Entity"
									options={businessEntityTypes}
									placeholder="Select entity type"
									labelClassName={labelClassName}
									required
								/>
								<TextField control={control} name="business.einNumber" label="EIN Number" placeholder="XX-XXXXXXX" labelClassName={labelClassName} required />
								<NumberField
									control={control}
									name="business.monthlyRevenue"
									label="Monthly Revenue"
									min={0}
									prefix="$"
									placeholder="0.00"
									labelClassName={labelClassName}
									required
								/>
								<TextField control={control} name="business.address.address1" label="Address 1" placeholder="Enter street address" labelClassName={labelClassName} required />
								<TextField control={control} name="business.address.address2" label="Address 2" placeholder="Enter apartment, suite, etc. (optional)" labelClassName={labelClassName} />
								<TextField control={control} name="business.address.city" label="City" placeholder="Enter city" labelClassName={labelClassName} required />
								<TextField control={control} name="business.address.state" label="State" required placeholder="e.g., FL" labelClassName={labelClassName} />
								<TextField control={control} name="business.address.zipCode" label="Zip Code" required placeholder="XXXXX" labelClassName={labelClassName} />
							</Section>

							{/* Business Owner Detail Section */}
							<Section
								title="Business Owner Detail"
								headerAction={!isViewMode && (
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={handleAddOwner}
										disabled={!canAddOwner}
										className="gap-2 border border-[#276D9C] text-[#276D9C] bg-transparent hover:bg-[#276D9C]/5 disabled:opacity-50 disabled:pointer-events-none"
									>
										<Plus className="size-4" />
										Add Owner
									</Button>
								)}
							>
								{fields.map((field, index) => (
									<div key={field.id} className="md:col-span-2 space-y-4">
										<div className="flex items-center justify-between border-b border-[#E5E7EB] dark:border-[#374151] pb-2">
											<h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-[#374151]'}`}>
												{getOwnerOrdinalLabel(index)}
											</h3>
											{index > 0 && !isViewMode && (
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => remove(index)}
													className="h-8 px-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
												>
													<Trash2 className="size-4 mr-1" />
													Remove
												</Button>
											)}
										</div>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
											<TextField control={control} name={`owners.${index}.firstName`} label="First Name" placeholder="Enter first name" labelClassName={labelClassName} required />
											<TextField control={control} name={`owners.${index}.middleName`} label="Middle Name" placeholder="Enter middle name (optional)" labelClassName={labelClassName} />
											<TextField control={control} name={`owners.${index}.lastName`} label="Last Name" placeholder="Enter last name" labelClassName={labelClassName} required />
											<EmailField control={control} name={`owners.${index}.email`} label="Email" placeholder="Enter email address" labelClassName={labelClassName} required />
											<PhoneField control={control} name={`owners.${index}.mobileNumber`} label="Mobile Number" placeholder="(XXX) XXX-XXXX" labelClassName={labelClassName} />
											<DateField control={control} name={`owners.${index}.dateOfBirth`} label="Date of Birth" labelClassName={labelClassName} usFormat placeholder="mm-dd-yyyy" required />
											<TextField control={control} name={`owners.${index}.ssn`} label="Social Security Number (SSN)" placeholder="XXX-XX-XXXX" labelClassName={labelClassName} required />
											<NumberField
												control={control}
												name={`owners.${index}.ficoScore`}
												label="FICO Score"
												min={300}
												max={850}
												placeholder="300-850"
												labelClassName={labelClassName}
												required
											/>
											<DateField control={control} name={`owners.${index}.ownershipStartDate`} label="Ownership Start Date" labelClassName={labelClassName} usFormat placeholder="mm-dd-yyyy" required />
											<NumberField
												control={control}
												name={`owners.${index}.ownershipPercentage`}
												label="Ownership Percentage"
												min={0}
												max={100}
												suffix="%"
												placeholder="0-100"
												labelClassName={labelClassName}
												required
											/>
											<TextField control={control} name={`owners.${index}.address.address1`} label="Address 1" placeholder="Enter street address" labelClassName={labelClassName} required />
											<TextField control={control} name={`owners.${index}.address.address2`} label="Address 2" placeholder="Enter apartment, suite, etc. (optional)" labelClassName={labelClassName} />
											<TextField control={control} name={`owners.${index}.address.city`} label="City" placeholder="Enter city" labelClassName={labelClassName} required />
											<TextField control={control} name={`owners.${index}.address.state`} label="State" required placeholder="e.g., FL" labelClassName={labelClassName} />
											<TextField control={control} name={`owners.${index}.address.zipCode`} label="Zip Code" required placeholder="XXXXX" labelClassName={labelClassName} />
										</div>
									</div>
								))}

								{!isViewMode && !canAddOwner && (
									<div className="md:col-span-2">
										<p className={`text-xs ${isDark ? 'text-gray-400' : 'text-[#6B7280]'}`}>
											Complete all required fields for the 1st owner to add another owner.
										</p>
									</div>
								)}
							</Section>
						</div>

						<div className="flex items-center justify-end gap-3 pt-2">
							<Button
								type="button"
								variant="outline"
								className="px-4 py-2 gap-2 border border-[#276D9C] text-[#276D9C] bg-transparent cursor-pointer shadow-[0px_1px_1px_0px_#0000001A] hover:bg-transparent hover:text-[#276D9C]/90"
								onClick={() => navigate('/clients')}
								disabled={isLoading}
							>
								{isViewMode ? 'Back' : 'Cancel'}
							</Button>
							{!isViewMode && (
								<Button
									type="submit"
									className="px-4 shadow-[0px_0px_0px_1px_#5E5ADB] py-2 gap-2 bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
									disabled={isLoading || !isValid}
								>
									{isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
									{isEditMode ? 'Update' : 'Submit'}
								</Button>
							)}
						</div>
					</form>
				</div>
			</div>
		</div>
	)
}

export default CreateClient
