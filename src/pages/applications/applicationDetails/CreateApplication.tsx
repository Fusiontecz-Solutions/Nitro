import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Controller, useForm, type SubmitHandler } from 'react-hook-form'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '@/redux/store'
import {
    createApplication,
    updateApplication,
    getApplicationByApplicationId,
    getApplicationById,
    uploadApplicationDocuments,
    getApplicationsByClient,
    parseApplicationPdfForClientPrefill,
} from '@/redux/actions/applicationActions'
import { getClients } from '@/redux/actions/clientActions'
import {
    resetCreateApplication,
    resetUpdateApplication,
    clearApplicationDetail,
    resetUploadDocuments,
} from '@/redux/slices/applicationSlice'
import { toast } from 'react-toastify'
import {
    ArrowLeft,
    Trash2,
    Loader2,
    Eye,
    Repeat,
    UserPlus,
} from 'lucide-react'
import uploadIcon from '../../../assets/folder.svg'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Card,
    CardContent,
} from '@/components/ui/card'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { useTheme } from '@/context/ThemeContext'
import PDFViewerDocsModal from '@/components/application/PDFViewerDocsModal'
import AutoCreateFromPdfPanel, {
    type AutoCreatePdfBundle,
} from '@/components/application/AutoCreateFromPdfPanel'
import {
    RefinanceDealSelectModal,
    type ClientDealForRefinance,
} from '@/components/application/RefinanceDealSelectModal'
import { cn, formatNumberUS, formatNumberUSForInput, parseNumberUS } from '@/lib/utils'
import { UsCurrencyInput } from '@/components/ui/us-currency-input'
import { resolveEffectiveRole, resolveSessionUser } from '@/lib/sessionRole'
import { isAgentRole, isWorkflowRole, WORKFLOW_QUEUE_PATH } from '@/lib/roleAccess'
import ApplicationWorkflowFields from '@/components/workflow/ApplicationWorkflowFields'
import {
    EMPTY_WORKFLOW_FIELDS,
    type ApplicationWorkflowFieldValues,
} from '@/lib/applicationWorkflowFields'

// Types
interface UploadedFile {
    id: string
    name: string
    type: string
    size: number
    file: File // Store the actual File object for upload  
}

interface ApplicationFormValues {
    client: string
    loanAmount: string
    createRefiDeal: boolean
    createNewClient: boolean
    newBusinessName: string
    newOwnerFirstName: string
    newOwnerLastName: string
    newEin: string
    newBusinessPhone: string
}

const DEFAULT_APPLICATION_PRIORITY = 'High'
const DEFAULT_APPLICATION_TYPE = 'New'
const REFINANCE_APPLICATION_TYPE = 'Refinance'
// Validation Schema
const applicationSchema = yup.object({
    createNewClient: yup.boolean().default(false),
    createRefiDeal: yup.boolean().default(false),
    client: yup.string().when('createNewClient', {
        is: true,
        then: (schema) => schema.optional().nullable(),
        otherwise: (schema) => schema.required('Client is required'),
    }),
    loanAmount: yup
        .string()
        .default('')
        .nullable()
        .test('valid-loan-amount', 'Enter a valid loan amount', (value) => {
            if (!value || !String(value).trim()) return true
            const n = parseNumberUS(value)
            return !Number.isNaN(n) && n >= 0
        }),
    newBusinessName: yup.string().when('createNewClient', {
        is: true,
        then: (schema) => schema.trim().required('Business name is required'),
        otherwise: (schema) => schema.optional(),
    }),
    newOwnerFirstName: yup.string().when('createNewClient', {
        is: true,
        then: (schema) => schema.trim().required('Owner first name is required'),
        otherwise: (schema) => schema.optional(),
    }),
    newOwnerLastName: yup.string().optional(),
    newEin: yup.string().optional(),
    newBusinessPhone: yup.string().optional(),
})

// Select Options
interface SelectOption {
    value: string
    label: string
}

function isRefinanceApplicationType(type: string | null | undefined): boolean {
    const t = String(type ?? '').trim().toLowerCase()
    return t === 'refinance' || t === 'refi'
}

function formatDealUsDate(value: unknown): string {
    if (value == null) return ''
    const t = String(value).trim()
    if (!t) return ''
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return t
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
        return `${t.slice(5, 7)}/${t.slice(8, 10)}/${t.slice(0, 4)}`
    }
    const d = new Date(t)
    if (Number.isNaN(d.getTime())) return t
    return new Intl.DateTimeFormat('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(d)
}

function mapApiDealToRefinanceOption(raw: Record<string, unknown>): ClientDealForRefinance {
    const id = String(raw._id ?? raw.id ?? '').trim()
    const positions = Array.isArray(raw.positions)
        ? (raw.positions as Array<Record<string, unknown>>)
        : []
    const balanceFromPositions = positions.reduce((sum, pos) => {
        const bal = Number(pos.mcaEstBalance)
        return Number.isFinite(bal) && bal > 0 ? sum + bal : sum
    }, 0)
    const explicitBalance = Number(raw.refinanceBalance)
    const loanAmount = Number(raw.loanAmount)
    const refinanceBalance =
        (Number.isFinite(explicitBalance) && explicitBalance > 0
            ? explicitBalance
            : null) ??
        (balanceFromPositions > 0 ? balanceFromPositions : null) ??
        (Number.isFinite(loanAmount) && loanAmount > 0 ? loanAmount : 0)

    const fundingDateFromPos = positions
        .map((p) => p.fundingDate)
        .find((d) => d != null && String(d).trim())

    return {
        id,
        applicationId: (raw.applicationId as number | string | null) ?? null,
        dealId: (raw.dealId as string | null) ?? null,
        type: (raw.type as string | null) ?? null,
        loanAmount: (raw.loanAmount as number | string | null) ?? null,
        currentQueue: (raw.currentQueue as string | null) ?? null,
        currentState: (raw.currentState as string | null) ?? null,
        createdAt: (raw.createdAt as string | null) ?? null,
        refinanceBalance,
        previousDealDate:
            formatDealUsDate(fundingDateFromPos) ||
            formatDealUsDate(raw.createdAt) ||
            '',
    }
}

// Utility function to format file size
const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    const size = Math.round(bytes / Math.pow(k, i))
    return `${size} ${sizes[i]}`
}

const defaultFormValues: ApplicationFormValues = {
    client: '',
    loanAmount: '',
    createRefiDeal: false,
    createNewClient: false,
    newBusinessName: '',
    newOwnerFirstName: '',
    newOwnerLastName: '',
    newEin: '',
    newBusinessPhone: '',
}

const CreateApplication = () => {
    const navigate = useNavigate()
    const dispatch = useDispatch<AppDispatch>()
    const { applicationId } = useParams<{ applicationId: string }>()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
    const [isAutoCreatingClient, setIsAutoCreatingClient] = useState(false)
    const [isDragOver, setIsDragOver] = useState(false)
    const [clientOptions, setClientOptions] = useState<SelectOption[]>([])
    const [isFormReset, setIsFormReset] = useState(false)
    const [isPDFModalOpen, setIsPDFModalOpen] = useState(false)
    const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null)
    const [pdfMimeTypeHint, setPdfMimeTypeHint] = useState<string>("")
    const [pdfFileName, setPdfFileName] = useState<string>('')
    const [refinanceDealModalOpen, setRefinanceDealModalOpen] = useState(false)
    const [selectedRefinanceDeal, setSelectedRefinanceDeal] =
        useState<ClientDealForRefinance | null>(null)
    const [clientDeals, setClientDeals] = useState<ClientDealForRefinance[]>([])
    const [clientDealsLoading, setClientDealsLoading] = useState(false)
    /** ISO link, notes and extra new-client details (Agent intake). */
    const [workflowFields, setWorkflowFields] =
        useState<ApplicationWorkflowFieldValues>(EMPTY_WORKFLOW_FIELDS)
    /** Agent: which footer button submitted the form. */
    const submitModeRef = useRef<'submit' | 'draft'>('submit')
    const sessionRoleKey = resolveEffectiveRole(undefined)
    const isAgentUser = isAgentRole(sessionRoleKey)
    /** Where "back" / "done" go: workflow roles use their queue, Super Admin the Applications list. */
    const listPath = isWorkflowRole(sessionRoleKey) ? WORKFLOW_QUEUE_PATH : '/applications'
    // Determine if we're in edit mode
    const isEditMode = !!applicationId

    // Redux state selectors
    const { loading: createLoading, success: createSuccess, error: createError } = useSelector(
        (state: RootState) => state.createApplication
    )
    const { loading: updateLoading, success: updateSuccess, error: updateError } = useSelector(
        (state: RootState) => state.updateApplication
    )
    const { loading: fetchLoading, data: applicationData, error: fetchError } = useSelector(
        (state: RootState) => state.applicationDetail
    )
    const { data: clients, loading: clientsLoading } = useSelector(
        (state: RootState) => state.clients
    )
    const { loading: uploadLoading, success: uploadSuccess, error: uploadError } = useSelector(
        (state: RootState) => state.uploadDocuments
    )
    const loginUser = useSelector((state: RootState) => state.login.data?.user)
    const sessionUser = useMemo(
        () => resolveSessionUser(loginUser),
        [loginUser],
    )
    /** Backend still requires salesRepresentativeId — default to logged-in Super Admin. */
    const currentUserId = sessionUser?.id?.trim() || ''

    const isLoading = isEditMode ? updateLoading : createLoading
    const isPageLoading = isEditMode && fetchLoading

    const {
        control,
        handleSubmit,
        formState: { errors, isValid },
        reset,
        watch,
        setValue,
    } = useForm<ApplicationFormValues>({
        resolver: yupResolver(applicationSchema) as any,
        mode: 'all',
        defaultValues: defaultFormValues,
    })

    const watchedClient = watch('client')
    const isCreatingNewClient = Boolean(watch('createNewClient')) && !isEditMode
    const isRefinanceType = Boolean(watch('createRefiDeal')) && !isCreatingNewClient

    const selectedClientLabel = useMemo(() => {
        return clientOptions.find((o) => o.value === watchedClient)?.label || ''
    }, [clientOptions, watchedClient])

    const loadClientDeals = useCallback(
        async (clientId: string) => {
            if (!clientId) {
                setClientDeals([])
                return
            }
            setClientDealsLoading(true)
            try {
                const result = (await dispatch(
                    getApplicationsByClient(clientId) as any,
                )) as {
                    payload?: { data?: unknown }
                    meta: { requestStatus: 'fulfilled' | 'rejected' }
                }
                if (result.meta.requestStatus !== 'fulfilled') {
                    setClientDeals([])
                    toast.error('Failed to load client deals')
                    return
                }
                const raw = result.payload?.data
                const list = Array.isArray(raw)
                    ? raw
                    : Array.isArray((raw as { data?: unknown } | undefined)?.data)
                      ? ((raw as { data: unknown[] }).data)
                      : []
                const mapped = (list as Record<string, unknown>[])
                    .map(mapApiDealToRefinanceOption)
                    .filter((d) => d.id)
                setClientDeals(mapped)
            } catch {
                setClientDeals([])
                toast.error('Failed to load client deals')
            } finally {
                setClientDealsLoading(false)
            }
        },
        [dispatch],
    )

    // When Refinance is selected with a client, open deal picker and load deals.
    useEffect(() => {
        if (!isRefinanceType) {
            setSelectedRefinanceDeal(null)
            setRefinanceDealModalOpen(false)
            return
        }
        if (!watchedClient) {
            setSelectedRefinanceDeal(null)
            return
        }
        void loadClientDeals(watchedClient)
        setRefinanceDealModalOpen(true)
    }, [isRefinanceType, watchedClient, loadClientDeals])

    // Clear selected REFI deal when client changes.
    useEffect(() => {
        setSelectedRefinanceDeal(null)
    }, [watchedClient])

    // Load clients up front whenever the dropdown is on screen (existing client / refinance / edit).
    // Fetching on open disabled the Select mid-open, so it collapsed to an empty popover.
    const clientsFetchedRef = useRef(false)
    useEffect(() => {
        if (clientsFetchedRef.current) return
        if (isEditMode || isRefinanceType || !isCreatingNewClient) {
            clientsFetchedRef.current = true
            dispatch(getClients({ limit: 100, lite: 1 }))
        }
    }, [dispatch, isEditMode, isRefinanceType, isCreatingNewClient])

    // Fetch application data when in edit mode
    useEffect(() => {
        // Reset the form reset flag when applicationId changes
        setIsFormReset(false)

        if (applicationId) {
            // Try to fetch by applicationId first (numeric), then by _id (MongoDB ObjectId)
            if (/^\d+$/.test(applicationId)) {
                dispatch(getApplicationByApplicationId(applicationId))
            } else {
                dispatch(getApplicationById(applicationId))
            }
        }
        return () => {
            dispatch(clearApplicationDetail())
        }
    }, [applicationId, dispatch])

    // Reset form values when applicationData is fetched AND options are populated
    useEffect(() => {
        // Skip if form has already been reset or not in edit mode
        if (isFormReset || !isEditMode || !applicationData) {
            return
        }

        // Wait for client options to be populated
        const hasClientOptions = clientOptions.length > 0

        // Only proceed if we have options loaded
        if (!hasClientOptions) {
            return
        }

        // Extract IDs from applicationData
        const clientId = typeof applicationData.client === 'string'
            ? applicationData.client
            : applicationData.client?._id || ''

        const formData: ApplicationFormValues = {
            client: clientId,
            loanAmount:
                applicationData.loanAmount != null
                    ? formatNumberUSForInput(String(applicationData.loanAmount))
                    : '',
            createRefiDeal: isRefinanceApplicationType(applicationData.type),
            createNewClient: false,
            newBusinessName: '',
            newOwnerFirstName: '',
            newOwnerLastName: '',
            newEin: '',
            newBusinessPhone: '',
        }

        reset(formData)
        setWorkflowFields({
            ...EMPTY_WORKFLOW_FIELDS,
            isoId: String((applicationData as { isoId?: string | null }).isoId ?? (applicationData.iso as any)?._id ?? (applicationData.iso as any)?.id ?? ''),
            note: String(applicationData.note ?? ''),
        })
        setIsFormReset(true) // Prevent multiple resets
    }, [applicationData, isEditMode, clientOptions, isFormReset, reset])

    // Handle fetch error
    useEffect(() => {
        if (fetchError) {
            toast.error(fetchError)
        }
    }, [fetchError])

    // Handle create success/error
    useEffect(() => {
        if (createSuccess) {
            toast.success('Application created successfully!')
            dispatch(resetCreateApplication())
            navigate(listPath, {
                state: { refreshApplicationsList: true },
            })
        }
        if (createError) {
            toast.error(createError)
            dispatch(resetCreateApplication())
        }
    }, [createSuccess, createError, dispatch, navigate])

    // Handle update success/error
    useEffect(() => {
        if (updateSuccess) {
            toast.success('Application updated successfully!')
            dispatch(resetUpdateApplication())
            navigate(listPath, {
                state: { refreshApplicationsList: true },
            })
        }
        if (updateError) {
            toast.error(updateError)
            dispatch(resetUpdateApplication())
        }
    }, [updateSuccess, updateError, dispatch, navigate])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            dispatch(resetCreateApplication())
            dispatch(resetUpdateApplication())
            dispatch(resetUploadDocuments())
        }
    }, [dispatch])

    // Handle file upload
    const handleFileUpload = useCallback((files: FileList | null) => {
        if (!files) return

        const newFiles: UploadedFile[] = Array.from(files).map((file) => ({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            file: file, // Store the actual File object
        }))

        setUploadedFiles((prev) => [...prev, ...newFiles])
    }, [])

    const handleAutoCreateClientFromPDF = useCallback(
        async (bundle: AutoCreatePdfBundle) => {
            const files = Array.isArray(bundle.files) ? bundle.files.filter(Boolean) : []
            if (!files.length) {
                toast.error('Please select one or more PDF files')
                return
            }
            const hasPdf = files.some(
                (f) =>
                    f.type === 'application/pdf' ||
                    f.name.toLowerCase().endsWith('.pdf'),
            )
            if (!hasPdf) {
                toast.error('Include at least one application PDF')
                return
            }

            setIsAutoCreatingClient(true)
            try {
                const result = (await dispatch(
                    parseApplicationPdfForClientPrefill({ files }) as any,
                )) as {
                    payload?: any
                    meta: { requestStatus: 'fulfilled' | 'rejected' }
                }

                if (result.meta.requestStatus !== 'fulfilled') {
                    toast.error(
                        (result as any)?.payload ||
                            'Failed to parse application PDF',
                    )
                    return
                }

                const rawData = result.payload?.data
                if (!rawData || !rawData.application || !rawData.client) {
                    toast.error('Failed to auto-create client/application from PDF')
                    return
                }

                const application = rawData.application as {
                    _id?: string
                    id?: string
                }
                const mongoId = application?._id || application?.id
                if (!mongoId) {
                    toast.error('Application was created but could not determine its id.')
                    return
                }

                const message =
                    typeof result.payload?.message === 'string' && result.payload.message.trim()
                        ? result.payload.message
                        : rawData.existingClient
                          ? 'Client already exists. Application has been created for the existing client.'
                          : 'Client created successfully and application generated.'
                toast.success(message)

                navigate(listPath, {
                    state: { refreshApplicationsList: true },
                })
            } catch (error) {
                console.error('[AutoCreate] unexpected error:', error)
                toast.error('Failed to parse application PDF')
            } finally {
                setIsAutoCreatingClient(false)
            }
        },
        [dispatch, navigate],
    )

    // Handle drag events
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)
    }, [])

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            setIsDragOver(false)
            handleFileUpload(e.dataTransfer.files)
        },
        [handleFileUpload]
    )

    // Handle file input click
    const handleDropZoneClick = useCallback(() => {
        fileInputRef.current?.click()
    }, [])

    // Handle file delete
    const handleDeleteFile = useCallback((id: string) => {
        setUploadedFiles((prev) => prev.filter((file) => file.id !== id))
    }, [])

    // Handle file view - open in modal
    const handleViewFile = useCallback((file: { file: File; name: string; type: string; size: number; id: string }) => {
        if (file.file) {
            const fileUrl = URL.createObjectURL(file.file)
            setPdfFileUrl(fileUrl)
            setPdfFileName(file.name)
            setPdfMimeTypeHint(file.file.type || file.type || "")
            setIsPDFModalOpen(true)
        }
    }, [])

    // Handle modal close - cleanup object URL
    const handleClosePDFModal = useCallback(() => {
        setIsPDFModalOpen(false)
        if (pdfFileUrl) {
            URL.revokeObjectURL(pdfFileUrl)
        }
        setPdfFileUrl(null)
        setPdfFileName('')
        setPdfMimeTypeHint("")
    }, [pdfFileUrl])

    // Handle document submit (for edit mode - upload files separately)
    const handleDocumentSubmit = useCallback(() => {
        if (!isEditMode || !applicationData?._id) {
            toast.error('Application ID not found for document upload')
            return
        }

        if (uploadedFiles.length === 0) {
            toast.warning('Please select files to upload')
            return
        }

        const files = uploadedFiles.map((f) => f.file)
        dispatch(uploadApplicationDocuments({
            id: applicationData._id,
            files,
        }))
    }, [uploadedFiles, isEditMode, applicationData, dispatch])

    // Handle upload success/error
    useEffect(() => {
        if (uploadSuccess) {
            toast.success('Documents uploaded successfully!')
            dispatch(resetUploadDocuments())
            setUploadedFiles([]) // Clear uploaded files after success
            // Refresh application data to show new documents
            if (applicationData?._id) {
                dispatch(getApplicationById(applicationData._id))
            }
        }
        if (uploadError) {
            toast.error(uploadError)
            dispatch(resetUploadDocuments())
        }
    }, [uploadSuccess, uploadError, dispatch, applicationData])

    // Form submit handler
    const onSubmit: SubmitHandler<ApplicationFormValues> = async (data) => {
        if (!currentUserId) {
            toast.error('Unable to determine the logged-in user. Please sign in again.')
            return
        }
        const createNewClient = Boolean(data.createNewClient) && !isEditMode
        if (!createNewClient && isRefinanceType && !selectedRefinanceDeal?.id) {
            toast.error('Select a previous deal to refinance before creating this application.')
            setRefinanceDealModalOpen(true)
            if (data.client) void loadClientDeals(data.client)
            return
        }

        const saveAsDraft = isAgentUser && submitModeRef.current === 'draft'
        if (isAgentUser && !isEditMode && !saveAsDraft && !workflowFields.isoId) {
            toast.error('Select the ISO for this application before submitting it to underwriting.')
            return
        }

        const clientId = String(data.client ?? '').trim()
        if (createNewClient) {
            const businessName = String(data.newBusinessName ?? '').trim()
            const ownerFirstName = String(data.newOwnerFirstName ?? '').trim()
            if (!businessName || !ownerFirstName) {
                toast.error('Business name and owner first name are required to create a client.')
                return
            }
        } else if (!clientId) {
            toast.error('Client is required.')
            return
        }

        const existingType = String(applicationData?.type ?? '').trim()
        const payload = {
            ...(createNewClient
                ? {
                      createNewClient: true,
                      newBusinessName: String(data.newBusinessName ?? '').trim(),
                      newOwnerFirstName: String(data.newOwnerFirstName ?? '').trim(),
                      newOwnerLastName: String(data.newOwnerLastName ?? '').trim(),
                      newEin: String(data.newEin ?? '').trim(),
                      newBusinessPhone: String(data.newBusinessPhone ?? '').trim(),
                      newBusinessEmail: workflowFields.newBusinessEmail.trim(),
                      newOwnerEmail: workflowFields.newOwnerEmail.trim(),
                      newOwnerPhone: workflowFields.newOwnerPhone.trim(),
                      newBusinessAddress1: workflowFields.newBusinessAddress1.trim(),
                      newBusinessCity: workflowFields.newBusinessCity.trim(),
                      newBusinessState: workflowFields.newBusinessState.trim(),
                      newBusinessZipCode: workflowFields.newBusinessZipCode.trim(),
                      newBusinessMonthlyRevenue: (() => {
                          const n = parseNumberUS(workflowFields.newBusinessMonthlyRevenue)
                          return Number.isNaN(n) ? '' : String(n)
                      })(),
                  }
                : { client: clientId }),
            // ISO link + notes (Agent intake; Super Admin may also set them on create).
            ...(workflowFields.isoId && (isAgentUser || !isEditMode) ? { isoId: workflowFields.isoId } : {}),
            ...((isAgentUser || !isEditMode) && workflowFields.note.trim()
                ? { note: workflowFields.note.trim() }
                : {}),
            ...(isAgentUser && !isEditMode ? { saveAsDraft } : {}),
            loanAmount: (() => {
                if (!data.loanAmount || !String(data.loanAmount).trim()) return null
                const n = parseNumberUS(data.loanAmount)
                return Number.isNaN(n) ? null : n
            })(),
            // Hidden from UI — API still requires these fields.
            priority:
                (isEditMode && applicationData?.priority
                    ? String(applicationData.priority)
                    : DEFAULT_APPLICATION_PRIORITY) || DEFAULT_APPLICATION_PRIORITY,
            type: isRefinanceType
                ? REFINANCE_APPLICATION_TYPE
                : isEditMode && existingType && !isRefinanceApplicationType(existingType)
                  ? existingType
                  : DEFAULT_APPLICATION_TYPE,
            // Hidden from UI — API still requires salesRepresentative; use current Super Admin.
            salesRepresentative: currentUserId,
            ...(isRefinanceType && selectedRefinanceDeal
                ? {
                      previousApplicationId: selectedRefinanceDeal.id,
                      refinanceAmount: selectedRefinanceDeal.refinanceBalance ?? 0,
                      previousDealDate: selectedRefinanceDeal.previousDealDate || '',
                  }
                : {}),
        }
        if (isEditMode && applicationData) {
            const id = applicationData._id
            if (id) {
                dispatch(updateApplication({ id, data: payload }))
            } else {
                toast.error('Application ID not found for update')
            }
        } else {
            // Create mode - attach files if any, otherwise just submit form data
            const files = uploadedFiles.length > 0 ? uploadedFiles.map((f) => f.file) : undefined
            dispatch(createApplication({ data: payload, files }))
        }
    }

    // Generate client options from fetched clients
    useEffect(() => {
        if (clients && Array.isArray(clients)) {
            const options: SelectOption[] = clients.map((client: any) => ({
                value: client._id,
                label: client.business?.name || `${client.owner?.firstName || ''} ${client.owner?.lastName || ''}`.trim() || client._id,
            }))
            setClientOptions(options)
        }
    }, [clients])

    // Hooks must run before any early return (edit mode flips isPageLoading between renders).
    const { resolvedTheme } = useTheme()
    const isDark = resolvedTheme === 'dark'

    // Show loading state while fetching application data in edit mode
    if (isPageLoading) {
        return (
            <div className="min-h-[calc(100vh-64px)] w-full bg-background p-4 md:p-6 lg:p-8 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-muted-foreground">Loading application details...</p>
                </div>
            </div>
        )
    }

    /** Section headers: fixed height, full-bleed bar, bottom rule — reads like aligned tab strips */
    const sectionHeaderBarClass = cn(
        'flex h-12 w-full shrink-0 items-center px-6 text-sm font-semibold leading-none tracking-tight font-roboto border-b',
        isDark
            ? 'border-slate-600/50 bg-[#232428] text-slate-100'
            : 'border-slate-200/90 bg-[#f8fafc] text-slate-800',
    )
    const fieldLabelClass = `text-sm font-medium font-roboto ${isDark ? 'text-white' : 'text-[#374151]'}`
    const fieldInputClass = `h-10 w-full rounded-md bg-background border ${isDark ? 'border-[#374151]' : 'border-[#E5E7EB]'}`
    const optionCardClass = (active: boolean, disabled = false) =>
        cn(
            'flex min-w-[220px] flex-1 items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            active
                ? isDark
                    ? 'border-[var(--brand)] bg-[var(--brand)]/15 shadow-[0_0_0_1px_var(--brand)]'
                    : 'border-[var(--brand)] bg-[var(--brand)]/5 shadow-[0_0_0_1px_var(--brand)]'
                : isDark
                    ? 'border-[#374151] bg-[#1a1b1e] hover:border-[#5AACEA]/50'
                    : 'border-[#E5E7EB] bg-white hover:border-[var(--brand)]/50 hover:bg-slate-50',
        )

    return (
        <div className="min-h-[calc(100vh-64px)] w-full bg-background p-4 md:p-6 lg:p-8">
            {/* Main Content */}
            <div className="w-full mx-auto">
                <div className="space-y-6">
                    {/* Title Card */}
                    <Card className={`flex justify-between px-2 py-3 rounded-lg shadow-[0px_4px_20px_0px_#00000005] ${isDark ? 'bg-[#141517]' : 'bg-white'
                        }`}>
                        <CardContent className="flex items-center gap-3 px-0">
                            <Button
                                onClick={() => navigate(listPath)}
                                variant="ghost"
                                className="h-10 gap-2 px-0 py-0 bg-card text-muted-foreground hover:bg-accent cursor-pointer"
                            >
                                <ArrowLeft className={`size-5 ${isDark ? 'text-white' : 'text-[#111827]'}`} />
                            </Button>
                            <span className={`text-[1.2rem] font-semibold ${isDark ? 'text-white' : 'text-[#111827]'}`}>
                                {isEditMode ? 'Edit Application' : 'Create new client + application'}
                            </span>
                        </CardContent>
                    </Card>

                    {/* PDF auto-create bypasses the Agent → Underwriter intake, so it is Super Admin only. */}
                    {!isEditMode && !isWorkflowRole(sessionRoleKey) ? (
                        <AutoCreateFromPdfPanel
                            isDark={isDark}
                            loading={isAutoCreatingClient}
                            onSubmit={handleAutoCreateClientFromPDF}
                        />
                    ) : null}

                    {/* Form - key forces re-render after form reset */}
                    <form key={isFormReset ? 'reset' : 'initial'} onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                        {/* Business Profile Section */}
                        <Card className={`overflow-hidden rounded-sm border box-border p-0 pb-5 shadow-[0px_4px_20px_0px_#00000005] ${isDark ? 'border-[#374151] bg-[#141517]' : 'border-[#FDFDFD]'
                            }`}>
                            <CardContent className="space-y-5 p-0 pb-6">
                                <h2 className={sectionHeaderBarClass}>
                                    {isCreatingNewClient ? 'Create new client + application' : 'Application Details'}
                                </h2>

                                <div className="grid grid-cols-1 gap-3 px-6 sm:grid-cols-2">
                                    <Controller
                                        control={control}
                                        name="createRefiDeal"
                                        render={({ field }) => {
                                            const active = Boolean(field.value) && !isCreatingNewClient
                                            return (
                                            <label
                                                className={optionCardClass(active, isCreatingNewClient)}
                                            >
                                                <Checkbox
                                                    checked={active}
                                                    disabled={isCreatingNewClient}
                                                    className="mt-0.5 size-5 rounded-[6px] [&_svg]:size-4"
                                                    onCheckedChange={(checked: boolean | 'indeterminate') => {
                                                        const next = checked === true
                                                        field.onChange(next)
                                                        if (next) {
                                                            if (watchedClient) {
                                                                void loadClientDeals(watchedClient)
                                                                setRefinanceDealModalOpen(true)
                                                            }
                                                        } else {
                                                            setSelectedRefinanceDeal(null)
                                                            setRefinanceDealModalOpen(false)
                                                        }
                                                    }}
                                                />
                                                <span className="flex min-w-0 items-start gap-2.5">
                                                    <Repeat
                                                        className={`mt-0.5 h-5 w-5 shrink-0 ${
                                                            active
                                                                ? 'text-[var(--brand)]'
                                                                : isDark
                                                                  ? 'text-slate-400'
                                                                  : 'text-slate-500'
                                                        }`}
                                                        aria-hidden
                                                    />
                                                    <span className="min-w-0">
                                                        <span className={`block text-sm font-semibold font-roboto ${isDark ? 'text-white' : 'text-[#111827]'}`}>
                                                            Create a refi deal
                                                        </span>
                                                        <span className={`mt-0.5 block text-xs leading-snug ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                                            {isCreatingNewClient
                                                                ? 'Unavailable while creating a new client'
                                                                : watchedClient
                                                                  ? 'Pick a previous deal for this client'
                                                                  : 'Select a client below, then choose the prior deal'}
                                                        </span>
                                                    </span>
                                                </span>
                                            </label>
                                            )
                                        }}
                                    />
                                    {!isEditMode && (
                                        <Controller
                                            control={control}
                                            name="createNewClient"
                                            render={({ field }) => {
                                                const active = Boolean(field.value)
                                                return (
                                                <label className={optionCardClass(active)}>
                                                    <Checkbox
                                                        checked={active}
                                                        className="mt-0.5 size-5 rounded-[6px] [&_svg]:size-4"
                                                        onCheckedChange={(checked: boolean | 'indeterminate') => {
                                                            const next = checked === true
                                                            field.onChange(next)
                                                            setValue('createNewClient', next, { shouldValidate: true })
                                                            if (next) {
                                                                setValue('createRefiDeal', false, { shouldValidate: true })
                                                                setValue('client', '', { shouldValidate: true })
                                                                setSelectedRefinanceDeal(null)
                                                                setRefinanceDealModalOpen(false)
                                                            }
                                                        }}
                                                    />
                                                    <span className="flex min-w-0 items-start gap-2.5">
                                                        <UserPlus
                                                            className={`mt-0.5 h-5 w-5 shrink-0 ${
                                                                active
                                                                    ? 'text-[var(--brand)]'
                                                                    : isDark
                                                                      ? 'text-slate-400'
                                                                      : 'text-slate-500'
                                                            }`}
                                                            aria-hidden
                                                        />
                                                        <span className="min-w-0">
                                                            <span className={`block text-sm font-semibold font-roboto ${isDark ? 'text-white' : 'text-[#111827]'}`}>
                                                                Create new client + application
                                                            </span>
                                                            <span className={`mt-0.5 block text-xs leading-snug ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                                                Enter business and owner details, then submit once
                                                            </span>
                                                        </span>
                                                    </span>
                                                </label>
                                                )
                                            }}
                                        />
                                    )}
                                </div>

                                {isCreatingNewClient ? (
                                    <div
                                        className={`mx-6 rounded-xl border px-4 py-4 space-y-4 ${
                                            isDark
                                                ? 'border-[var(--brand)]/40 bg-[#1a1b1e]'
                                                : 'border-[var(--brand)]/25 bg-[var(--brand)]/[0.03]'
                                        }`}
                                    >
                                        <div>
                                            <p className={`text-sm font-semibold font-roboto ${isDark ? 'text-white' : 'text-[#111827]'}`}>
                                                Create new client + application
                                            </p>
                                            <p className={`mt-0.5 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                                Fill in the client, then submit to create both together.
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                            <div className="flex min-w-0 flex-col gap-1.5">
                                                <Label className={fieldLabelClass}>
                                                    Business Name <span className="text-red-500">*</span>
                                                </Label>
                                                <Controller
                                                    control={control}
                                                    name="newBusinessName"
                                                    render={({ field }) => (
                                                        <Input
                                                            {...field}
                                                            placeholder="Enter business name"
                                                            className={fieldInputClass}
                                                        />
                                                    )}
                                                />
                                                {errors.newBusinessName && (
                                                    <p className="text-xs text-red-500">
                                                        {errors.newBusinessName.message}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex min-w-0 flex-col gap-1.5">
                                                <Label className={fieldLabelClass}>
                                                    Owner First Name <span className="text-red-500">*</span>
                                                </Label>
                                                <Controller
                                                    control={control}
                                                    name="newOwnerFirstName"
                                                    render={({ field }) => (
                                                        <Input
                                                            {...field}
                                                            placeholder="Enter first name"
                                                            className={fieldInputClass}
                                                        />
                                                    )}
                                                />
                                                {errors.newOwnerFirstName && (
                                                    <p className="text-xs text-red-500">
                                                        {errors.newOwnerFirstName.message}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex min-w-0 flex-col gap-1.5">
                                                <Label className={fieldLabelClass}>
                                                    Owner Last Name
                                                </Label>
                                                <Controller
                                                    control={control}
                                                    name="newOwnerLastName"
                                                    render={({ field }) => (
                                                        <Input
                                                            {...field}
                                                            placeholder="Enter last name"
                                                            className={fieldInputClass}
                                                        />
                                                    )}
                                                />
                                            </div>
                                            <div className="flex min-w-0 flex-col gap-1.5">
                                                <Label className={fieldLabelClass}>EIN</Label>
                                                <Controller
                                                    control={control}
                                                    name="newEin"
                                                    render={({ field }) => (
                                                        <Input
                                                            {...field}
                                                            placeholder="XX-XXXXXXX"
                                                            className={fieldInputClass}
                                                        />
                                                    )}
                                                />
                                            </div>
                                            <div className="flex min-w-0 flex-col gap-1.5">
                                                <Label className={fieldLabelClass}>
                                                    Business Phone
                                                </Label>
                                                <Controller
                                                    control={control}
                                                    name="newBusinessPhone"
                                                    render={({ field }) => (
                                                        <Input
                                                            {...field}
                                                            placeholder="(XXX) XXX-XXXX"
                                                            className={fieldInputClass}
                                                        />
                                                    )}
                                                />
                                            </div>
                                            <div className="flex min-w-0 flex-col gap-1.5">
                                                <Label className={fieldLabelClass}>Loan Amount</Label>
                                                <Controller
                                                    control={control}
                                                    name="loanAmount"
                                                    render={({ field }) => (
                                                        <UsCurrencyInput
                                                            value={field.value ?? ''}
                                                            onChange={field.onChange}
                                                            onBlur={field.onBlur}
                                                            name={field.name}
                                                            ref={field.ref}
                                                            className={fieldInputClass}
                                                        />
                                                    )}
                                                />
                                                {errors.loanAmount && (
                                                    <p className="text-xs text-red-500">
                                                        {errors.loanAmount.message}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                <div className="grid grid-cols-1 gap-4 px-6 sm:grid-cols-2 lg:items-end">
                                    <div className="flex min-w-0 flex-col gap-1.5">
                                        <Label className={fieldLabelClass}>
                                            Client <span className="text-red-500">*</span>
                                        </Label>
                                        <Controller
                                            control={control}
                                            name="client"
                                            render={({ field }) => (
                                                <Select
                                                    value={field.value}
                                                    onValueChange={(value: string) => {
                                                        field.onChange(value)
                                                        setSelectedRefinanceDeal(null)
                                                        if (isRefinanceType && value) {
                                                            void loadClientDeals(value)
                                                            setRefinanceDealModalOpen(true)
                                                        }
                                                    }}
                                                >
                                                    <SelectTrigger className={`${fieldInputClass} w-full`}>
                                                        <SelectValue placeholder={clientsLoading ? "Loading clients..." : "Select Client"} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {clientOptions.length === 0 ? (
                                                            <div className="px-3 py-2 text-sm text-muted-foreground">
                                                                {clientsLoading ? 'Loading clients...' : 'No clients found.'}
                                                            </div>
                                                        ) : (
                                                            clientOptions.map((option) => (
                                                                <SelectItem key={option.value} value={option.value}>
                                                                    {option.label}
                                                                </SelectItem>
                                                            ))
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                        {errors.client && (
                                            <p className="text-xs text-red-500">
                                                {errors.client.message}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex min-w-0 flex-col gap-1.5">
                                        <Label className={fieldLabelClass}>
                                            Loan Amount
                                        </Label>
                                        <Controller
                                            control={control}
                                            name="loanAmount"
                                            render={({ field }) => (
                                                <UsCurrencyInput
                                                    value={field.value ?? ''}
                                                    onChange={field.onChange}
                                                    onBlur={field.onBlur}
                                                    name={field.name}
                                                    ref={field.ref}
                                                    className={fieldInputClass}
                                                />
                                            )}
                                        />
                                        {errors.loanAmount && (
                                            <p className="text-xs text-red-500">
                                                {errors.loanAmount.message}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                )}

                                <ApplicationWorkflowFields
                                    value={workflowFields}
                                    onChange={setWorkflowFields}
                                    showNewClientFields={isCreatingNewClient}
                                    isoRequired={isAgentUser}
                                    labelClass={fieldLabelClass}
                                    inputClass={fieldInputClass}
                                />

                                {isRefinanceType && (
                                    <div className={`mx-6 rounded-xl border px-4 py-4 ${
                                        isDark
                                            ? 'border-dashed border-slate-600 bg-slate-900/40'
                                            : 'border-dashed border-[#D7DEE8] bg-slate-50'
                                    }`}>
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="space-y-1 text-sm">
                                                <p className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                                                    Previous deal for refinance
                                                </p>
                                                {selectedRefinanceDeal ? (
                                                    <p className="text-muted-foreground">
                                                        Deal{" "}
                                                        <span className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                                                            {selectedRefinanceDeal.dealId ||
                                                                (selectedRefinanceDeal.applicationId != null
                                                                    ? `#${selectedRefinanceDeal.applicationId}`
                                                                    : selectedRefinanceDeal.id.slice(0, 8))}
                                                        </span>
                                                        {" · "}
                                                        REFI{" "}
                                                        <span className="font-semibold tabular-nums">
                                                            $
                                                            {formatNumberUS(
                                                                selectedRefinanceDeal.refinanceBalance ?? 0,
                                                            )}
                                                        </span>
                                                        {" · "}
                                                        Date{" "}
                                                        <span className="font-semibold">
                                                            {selectedRefinanceDeal.previousDealDate || "—"}
                                                        </span>
                                                    </p>
                                                ) : (
                                                    <p className="text-amber-700 dark:text-amber-400">
                                                        {watchedClient
                                                            ? 'Select a prior deal for this client to continue.'
                                                            : 'Select a client first, then pick the previous deal.'}
                                                    </p>
                                                )}
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-10 shrink-0"
                                                disabled={!watchedClient}
                                                loading={clientDealsLoading}
                                                onClick={() => {
                                                    if (!watchedClient) return
                                                    void loadClientDeals(watchedClient)
                                                    setRefinanceDealModalOpen(true)
                                                }}
                                            >
                                                {selectedRefinanceDeal ? 'Change deal' : 'Select deal'}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Documents Section */}
                        <Card className={`overflow-hidden rounded-sm border box-border p-0 pb-5 shadow-[0px_4px_20px_0px_#00000005] ${isDark ? 'border-[#374151] bg-[#141517]' : 'border-[#FDFDFD]'
                            }`}>
                            <CardContent className="space-y-4 p-0">
                                <div className="space-y-0">
                                    <h2 className={sectionHeaderBarClass}>Documents</h2>
                                    <p
                                        className={cn(
                                            'px-6 pt-4 font-roboto text-sm font-normal leading-relaxed',
                                            isDark ? 'text-slate-400' : 'text-muted-foreground',
                                        )}
                                    >
                                        Upload documents here
                                    </p>
                                </div>

                                {/* Drag & Drop Upload Zone */}
                                <div
                                    onClick={handleDropZoneClick}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    className={`mx-6
                                        relative flex flex-col items-center justify-center
                                        h-[220px] rounded-lg border-2 border-dashed cursor-pointer
                                        transition-colors duration-200
                                        ${isDragOver
                                            ? 'border-blue-500 bg-blue-500/5'
                                            : 'border-border hover:border-[#AEB2BD] bg-background'
                                        }
                                    `}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        multiple
                                        className="hidden"
                                        onChange={(e) => handleFileUpload(e.target.files)}
                                    />
                                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                                        <div className="relative">
                                            {/* <div className="size-16 bg-muted rounded-lg flex items-center justify-center">
                                                <FolderUp className="size-8 text-muted-foreground" />
                                            </div>
                                            <div className="absolute -top-1 -right-1 size-5 bg-orange-400 rounded-full flex items-center justify-center">
                                                <span className="text-white text-xs">↑</span>
                                            </div> */}
                                            <img
                                                src={uploadIcon}
                                                alt="upload icon"
                                                className="w-20 h-16"
                                            />
                                        </div>
                                        <p className={`text-sm font-[600] font-roboto ${isDark ? 'text-white' : 'text-[#374151]'}`}>
                                            Drop files here or click to upload.
                                        </p>
                                    </div>
                                </div>

                                {/* Document Submit Button - Only show in edit mode */}
                                {isEditMode && (
                                    <Button
                                        type="button"
                                        onClick={handleDocumentSubmit}
                                        className="h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90"
                                        disabled={uploadedFiles.length === 0}
                                        loading={uploadLoading}
                                    >
                                        Upload Documents
                                    </Button>
                                )}
                                {/* Info text for create mode */}
                                {!isEditMode && uploadedFiles.length > 0 && (
                                    <p className={`text-sm font-[400] font-roboto px-6 ${isDark ? 'text-white' : 'text-[#687182]'}`}>
                                        {uploadedFiles.length} file(s) will be uploaded with the application
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        {/* Uploaded Documents Table — title strip + thead use Applications list colors; row hover matches DataTableContent */}
                        <Card className={`overflow-hidden rounded-[5px] border box-border p-0 pb-5 shadow-[0px_4px_20px_0px_#00000005] transition-all duration-300 ${isDark ? 'border-[#374151] bg-[#141517]' : 'border-[#FDFDFD] bg-card'
                            }`}>
                            <CardContent className="p-0">
                                <h2
                                    className={cn(
                                        'flex h-12 w-full shrink-0 items-center px-6 font-roboto text-[1rem] font-semibold uppercase tracking-wide border-b',
                                        isDark
                                            ? 'border-[#374151] bg-[#2A2B2F] text-foreground'
                                            : 'border-[#ECEFF5] bg-[#F9FAFD] text-slate-800',
                                    )}
                                >
                                    Uploaded Documents
                                </h2>

                                <div className={cn('overflow-hidden p-1', isDark ? 'bg-[#141517]' : 'bg-card')}>
                                    <Table>
                                        <TableHeader>
                                            <TableRow
                                                className={cn(
                                                    'border-b transition-colors',
                                                    isDark
                                                        ? 'border-[#374151] bg-[#1a1b1e] hover:!bg-[#1a1b1e]'
                                                        : 'border-[#ECEFF5] bg-slate-100/90 hover:!bg-slate-100/90',
                                                )}
                                            >
                                                <TableHead className={cn('h-12 min-h-12 px-6 py-0 align-middle font-roboto text-[11px] font-semibold uppercase tracking-wider text-left first:pl-6 last:pr-6', isDark ? 'text-muted-foreground' : 'text-slate-600')}>
                                                    File Name
                                                </TableHead>
                                                <TableHead className={cn('h-12 min-h-12 px-6 py-0 align-middle font-roboto text-[11px] font-semibold uppercase tracking-wider text-left', isDark ? 'text-muted-foreground' : 'text-slate-600')}>
                                                    Content Type
                                                </TableHead>
                                                <TableHead className={cn('h-12 min-h-12 px-6 py-0 align-middle font-roboto text-[11px] font-semibold uppercase tracking-wider text-left', isDark ? 'text-muted-foreground' : 'text-slate-600')}>
                                                    File Size
                                                </TableHead>
                                                <TableHead className={cn('h-12 min-h-12 px-6 py-0 text-right align-middle font-roboto text-[11px] font-semibold uppercase tracking-wider last:pr-6', isDark ? 'text-muted-foreground' : 'text-slate-600')}>
                                                    Action
                                                </TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {uploadedFiles.length === 0 ? (
                                                <TableRow
                                                    className={cn(
                                                        'border-b transition-colors',
                                                        isDark
                                                            ? 'border-[#374151] bg-[#141517] hover:!bg-[#141517]'
                                                            : 'border-transparent bg-card hover:!bg-card',
                                                    )}
                                                >
                                                    <TableCell
                                                        colSpan={4}
                                                        className={cn(
                                                            'h-24 text-left font-roboto text-sm',
                                                            isDark ? 'text-foreground' : 'text-muted-foreground',
                                                        )}
                                                    >
                                                        No documents uploaded
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                uploadedFiles.map((file, rowIdx) => (
                                                    <TableRow
                                                        key={file.id}
                                                        className={cn(
                                                            'border-b transition-colors hover:bg-accent',
                                                            isDark ? 'border-[#374151]' : 'border-[#ECEFF5]',
                                                            rowIdx % 2 ? 'bg-muted/50' : '',
                                                        )}
                                                    >
                                                        <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-foreground')}>
                                                            {file.name}
                                                        </TableCell>
                                                        <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-foreground')}>
                                                            {file.type}
                                                        </TableCell>
                                                        <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-foreground')}>
                                                            {formatFileSize(file.size)}
                                                        </TableCell>
                                                        <TableCell className="text-left py-3 px-6">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => handleViewFile(file)}
                                                                    className="text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 h-4 w-4 py-0 px-2"
                                                                    title="View file"
                                                                >
                                                                    <Eye className="size-4" />
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => handleDeleteFile(file.id)}
                                                                    className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 h-4 w-4 py-0 px-2"
                                                                    title="Delete file"
                                                                >
                                                                    <Trash2 className="size-4" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Footer Buttons */}
                        <div className="flex items-center justify-end gap-3 pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="px-4 py-2 gap-2 border border-[var(--brand)] text-[var(--brand)] bg-transparent cursor-pointer shadow-[0px_1px_1px_0px_#0000001A] hover:bg-transparent hover:text-[var(--brand)]/90"
                                onClick={() => navigate(listPath)}
                                disabled={isLoading}
                            >
                                Cancel
                            </Button>
                            {isAgentUser && !isEditMode ? (
                                <Button
                                    type="submit"
                                    variant="outline"
                                    className="px-4 py-2 gap-2 border border-[var(--brand)] text-[var(--brand)] bg-transparent cursor-pointer hover:bg-transparent hover:text-[var(--brand)]/90"
                                    disabled={isLoading || !isValid || (isRefinanceType && !selectedRefinanceDeal)}
                                    onClick={() => {
                                        submitModeRef.current = 'draft'
                                    }}
                                >
                                    Save as draft
                                </Button>
                            ) : null}
                            <Button
                                type="submit"
                                className="px-4 shadow-[0px_0px_0px_1px_var(--brand)] py-2 gap-2 bg-[image:var(--brand-gradient)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                                loading={isLoading}
                                disabled={
                                    !isValid ||
                                    (isRefinanceType && !selectedRefinanceDeal) ||
                                    (isAgentUser && !isEditMode && !workflowFields.isoId)
                                }
                                onClick={() => {
                                    submitModeRef.current = 'submit'
                                }}
                            >
                                {isEditMode
                                    ? 'Update'
                                    : isAgentUser
                                      ? 'Submit to underwriting'
                                      : isCreatingNewClient
                                        ? 'Create client + application'
                                        : 'Submit'}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>

            {/* PDF Viewer Modal */}
            <PDFViewerDocsModal
                isOpen={isPDFModalOpen}
                onClose={handleClosePDFModal}
                fileUrl={pdfFileUrl}
                fileName={pdfFileName}
                mimeTypeHint={pdfMimeTypeHint}
            />

            <RefinanceDealSelectModal
                open={refinanceDealModalOpen}
                onOpenChange={setRefinanceDealModalOpen}
                deals={clientDeals}
                loading={clientDealsLoading}
                selectedDealId={selectedRefinanceDeal?.id ?? null}
                clientLabel={selectedClientLabel}
                onSelect={(deal) => {
                    setSelectedRefinanceDeal(deal)
                    setRefinanceDealModalOpen(false)
                    toast.success('Previous deal selected for refinance')
                }}
            />
        </div>
    )
}

export default CreateApplication
