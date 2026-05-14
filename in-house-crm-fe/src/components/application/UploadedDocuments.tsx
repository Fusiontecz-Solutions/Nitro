import { useEffect, useRef, useState } from "react"
import { Card, CardContent } from "../ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table"
import { Button } from "../ui/button"
import { Trash2, Eye } from "lucide-react"
import { useDispatch, useSelector } from "react-redux"
import type { AppDispatch, RootState } from "@/redux/store"
import type { ApplicationFiles } from "@/types/applicationTypes"
import { deleteApplicationFile, getApplicationByApplicationId, uploadApplicationDocuments } from "@/redux/actions/applicationActions"
import { getDocumentRequestsByApplication } from "@/redux/actions/notificationActions"
import { toast } from "react-toastify"
import { useTheme } from "@/context/ThemeContext"
import PDFViewerDocsModal from "./PDFViewerDocsModal"
import { formatDateTimeUS, cn } from "@/lib/utils"

type UploadedDocumentsProps = {
    applicationId?: string
    /** Hide upload/delete and required-doc acknowledgements (e.g. OPERATIONS view-only). */
    readOnly?: boolean
}

const UploadedDocuments = ({ applicationId, readOnly = false }: UploadedDocumentsProps) => {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const [uploadedFiles, setUploadedFiles] = useState<ApplicationFiles[]>([])
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const [isPDFModalOpen, setIsPDFModalOpen] = useState(false)
    const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null)
    const [pdfFileName, setPdfFileName] = useState<string>("")
    const [acknowledgedRequiredDocs, setAcknowledgedRequiredDocs] = useState<string[]>([])
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    const { data: applicationData } = useSelector(
        (state: RootState) => state.applicationDetail
    )
    const { loading: uploadLoading } = useSelector(
        (state: RootState) => state.uploadDocuments
    )
    const { data: documentRequests } = useSelector(
        (state: RootState) => state.documentRequests
    )

    const dispatch: AppDispatch = useDispatch()

    // When an applicationId prop is provided (from ApplicationSheetFiles),
    // make sure we load that application into applicationDetail so files are available.
    useEffect(() => {
        if (!applicationId) return

        // If we already have the correct application loaded, skip refetch
        const currentKey =
            applicationData?.applicationId != null
                ? String(applicationData.applicationId)
                : applicationData?._id

        if (currentKey && String(currentKey) === String(applicationId)) {
            return
        }

        // Treat the prop as business applicationId (what the sheet passes, e.g. "1")
        dispatch(getApplicationByApplicationId(applicationId))
    }, [applicationId, applicationData?.applicationId, applicationData?._id, dispatch])

    // If an applicationId prop is provided (from sheet), ensure we have
    // the matching application loaded into applicationDetail.

    useEffect(() => {
        if (!applicationId) return;

        dispatch(getApplicationByApplicationId(applicationId));
    }, [applicationId, dispatch]);

    useEffect(() => {
        if (applicationData?.files) {
            setUploadedFiles(applicationData.files)
        }
    }, [applicationData])
    // Load existing files and acknowledged required docs for this application
    useEffect(() => {
        if (applicationData?.files) {
            setUploadedFiles(applicationData.files)
        }

        if (typeof window !== "undefined" && applicationData?._id) {
            const key = `requiredDocsCompleted:${applicationData._id}`
            const raw = localStorage.getItem(key)
            if (raw) {
                try {
                    const parsed = JSON.parse(raw)
                    if (Array.isArray(parsed)) {
                        setAcknowledgedRequiredDocs(parsed as string[])
                    }
                } catch {
                    // ignore parse errors
                }
            }
        }
    }, [applicationData])

    // Fetch required / requested documents for this application
    useEffect(() => {
        if (applicationData?._id) {
            dispatch(getDocumentRequestsByApplication(applicationData._id))
        }
    }, [dispatch, applicationData?._id])

    // Utility function to format file size
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes'
        const k = 1024
        const sizes = ['Bytes', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        const size = Math.round(bytes / Math.pow(k, i))
        return `${size} ${sizes[i]}`
    }

    // Handle file delete
    const handleDeleteFile = async (id: string) => {
        // For file APIs the backend expects the Mongo _id in the /applications/:id/files route
        if (!applicationData?._id) {
            toast.error("Application ID not found")
            return
        }

        await dispatch(deleteApplicationFile({ applicationId: applicationData._id, fileId: id as string }))

        // Refresh the application (and its files) using the business applicationId if available,
        // otherwise fall back to the applicationId prop coming from the sheet.
        const refreshKey = applicationData.applicationId ?? applicationId
        if (refreshKey != null) {
            await dispatch(getApplicationByApplicationId(refreshKey))
        }

        toast.success("File deleted successfully")
    }

    // Handle local file selection (multiple)
    const handleSelectFiles = (files: FileList | null) => {
        if (!files || files.length === 0) return
        const newFiles = Array.from(files)
        setSelectedFiles((prev) => [...prev, ...newFiles])
    }

    const handleOpenFilePicker = () => {
        fileInputRef.current?.click()
    }

    // Upload selected documents for this application
    const handleUploadSelectedFiles = async () => {
        // For upload the backend also expects the Mongo _id of the application
        if (!applicationData?._id) {
            toast.error("Application ID not found")
            return
        }
        if (selectedFiles.length === 0) {
            toast.warning("Please select one or more documents to upload")
            return
        }

        try {
            await dispatch(
                uploadApplicationDocuments({
                    id: applicationData._id,
                    files: selectedFiles,
                })
            ).unwrap()

            toast.success("Documents uploaded successfully")
            setSelectedFiles([])

            // Refresh the application and its files
            const refreshKey = applicationData.applicationId ?? applicationId
            if (refreshKey != null) {
                await dispatch(getApplicationByApplicationId(refreshKey))
            }

            // Refresh required documents status after upload
            await dispatch(getDocumentRequestsByApplication(applicationData._id))
        } catch (error: any) {
            const message =
                typeof error === "string"
                    ? error
                    : error?.message || "Failed to upload documents"
            toast.error(message)
        }
    }

    // Handle file view (open in PDF modal)
    const handleViewFile = (file: ApplicationFiles) => {
        if (file.url) {
            setPdfFileUrl(file.url)
            setPdfFileName(file.originalName || "Document")
            setIsPDFModalOpen(true)
        } else {
            toast.error("File URL not available")
        }
    }

    const handleClosePDFModal = () => {
        setIsPDFModalOpen(false)
        setPdfFileUrl(null)
        setPdfFileName("")
    }

    // Format required document name nicely
    const formatRequiredDocName = (name: string) => {
        if (!name) return ""
        return name
            .replace(/[-_]/g, " ")
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(" ")
    }

    // Documents still visible in this list (not acknowledged in this session)
    const visibleRequiredDocuments =
        (documentRequests || []).filter(
            (doc: any) => !acknowledgedRequiredDocs.includes(doc.name)
        )

    return (
        <Card
            className={`rounded-lg box-border p-0 border py-0 gap-0 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.14),0_4px_14px_-4px_rgba(15,23,42,0.08)] dark:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)] ${isDark ? "border-[#374151] bg-[#141517]" : "border-slate-200/90 bg-card"
                }`}
        >
            <CardContent className="p-0">
                <div
                    className={cn(
                        'flex items-center justify-between gap-3 border-b px-6 py-3',
                        isDark
                            ? 'border-[#374151] bg-[#2A2B2F]'
                            : 'border-[#ECEFF5] bg-[#F9FAFD]',
                    )}
                >
                    <h2
                        className={cn(
                            'font-roboto text-[1rem] font-semibold uppercase tracking-wide',
                            isDark ? 'text-foreground' : 'text-slate-800',
                        )}
                    >
                        Uploaded Documents
                    </h2>
                    {!readOnly && (
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(e) => handleSelectFiles(e.target.files)}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleOpenFilePicker}
                                className="h-8 px-3 text-xs font-medium cursor-pointer shadow-sm"
                            >
                                Choose files
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={handleUploadSelectedFiles}
                                disabled={selectedFiles.length === 0 || uploadLoading}
                                className="h-8 px-3 text-xs font-medium bg-[#276D9C] hover:bg-[#276D9C] text-white cursor-pointer shadow-md"
                            >
                                {uploadLoading ? "Uploading..." : "Upload"}
                            </Button>
                        </div>
                    )}
                </div>
                {!readOnly && selectedFiles.length > 0 && (
                    <p className={`px-6 pb-2 text-xs font-roboto ${isDark ? "text-gray-300" : "text-gray-600"
                        }`}>
                        {selectedFiles.length} document(s) selected to upload
                    </p>
                )}

                {/* Required documents coming from Underwriter requests */}
                {!readOnly && visibleRequiredDocuments.length > 0 && (
                    <div className="px-6 pb-4">
                        <h3
                            className={`text-xs font-semibold tracking-wide uppercase mb-2 ${isDark ? "text-gray-300" : "text-gray-600"
                                }`}
                        >
                            Required Documents
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {visibleRequiredDocuments.map((doc: any, index: number) => {
                                const isChecked = acknowledgedRequiredDocs.includes(doc.name)

                                const handleCheck = () => {
                                    // Mark this required document as acknowledged/completed for this application
                                    setAcknowledgedRequiredDocs((prev) => {
                                        if (prev.includes(doc.name)) return prev
                                        const updated = [...prev, doc.name]
                                        if (typeof window !== "undefined" && applicationData?._id) {
                                            const key = `requiredDocsCompleted:${applicationData._id}`
                                            localStorage.setItem(key, JSON.stringify(updated))
                                        }
                                        return updated
                                    })
                                }

                                return (
                                    <button
                                        key={`${doc.name}-${index}`}
                                        type="button"
                                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] ${isDark
                                                ? "border-[#374151] bg-[#111827] text-gray-100"
                                                : "border-gray-200 bg-white text-gray-800"
                                            }`}
                                        onClick={() => {
                                            if (isChecked) return
                                            handleCheck()
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            className="h-3 w-3 accent-[#276D9C] cursor-pointer"
                                            checked={isChecked}
                                            onChange={(e) => {
                                                if (e.target.checked && !isChecked) {
                                                    handleCheck()
                                                }
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <span className="font-semibold truncate max-w-[150px]">
                                            {formatRequiredDocName(doc.name)}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                <div className={cn('overflow-hidden border-none p-1', isDark ? 'bg-[#141517]' : 'bg-card')}>
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
                                <TableHead
                                    className={cn(
                                        'py-3 px-6 font-roboto text-xs font-semibold uppercase tracking-wider',
                                        isDark ? 'text-muted-foreground' : 'text-[#687182]',
                                    )}
                                >
                                    File Name
                                </TableHead>
                                <TableHead
                                    className={cn(
                                        'py-3 px-6 font-roboto text-xs font-semibold uppercase tracking-wider',
                                        isDark ? 'text-muted-foreground' : 'text-[#687182]',
                                    )}
                                >
                                    File Size
                                </TableHead>
                                <TableHead
                                    className={cn(
                                        'py-3 px-6 font-roboto text-xs font-semibold uppercase tracking-wider',
                                        isDark ? 'text-muted-foreground' : 'text-[#687182]',
                                    )}
                                >
                                    Uploaded At
                                </TableHead>
                                {!readOnly && (
                                    <TableHead
                                        className={cn(
                                            'py-3 px-6 text-left font-roboto text-xs font-semibold uppercase tracking-wider',
                                            isDark ? 'text-muted-foreground' : 'text-[#687182]',
                                        )}
                                    >
                                        Action
                                    </TableHead>
                                )}
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
                                        colSpan={readOnly ? 3 : 4}
                                        className={cn(
                                            'h-24 text-center font-roboto text-sm',
                                            isDark ? 'text-foreground' : 'text-muted-foreground',
                                        )}
                                    >
                                        No data available
                                    </TableCell>
                                </TableRow>
                            ) : (
                                uploadedFiles.map((file, rowIdx) => (
                                    <TableRow
                                        key={file._id}
                                        className={cn(
                                            'border-b transition-colors hover:bg-accent',
                                            isDark ? 'border-[#374151]' : 'border-[#ECEFF5]',
                                            rowIdx % 2 ? 'bg-muted/50' : '',
                                        )}
                                    >
                                        <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-foreground')}>
                                            {file.originalName}
                                        </TableCell>
                                        <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-foreground')}>
                                            {formatFileSize(file.size || 0)}
                                        </TableCell>
                                        <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-foreground')}>
                                            {formatDateTimeUS(file.uploadedAt, "N/A")}
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
                                                {!readOnly && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        onClick={() => handleDeleteFile(file._id || '')}
                                                        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 h-4 w-4 py-0 px-2"
                                                        title="Delete file"
                                                    >
                                                        <Trash2 className="size-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
            {/* PDF Viewer Modal */}
            <PDFViewerDocsModal
                isOpen={isPDFModalOpen}
                onClose={handleClosePDFModal}
                fileUrl={pdfFileUrl}
                fileName={pdfFileName}
            />
        </Card >
    )
}

export default UploadedDocuments;