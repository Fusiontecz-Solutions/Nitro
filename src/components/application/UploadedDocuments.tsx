import { useEffect, useRef, useState } from "react"
import { RequestedDocumentsPanel } from "./RequestedDocumentsPanel"
import { getDocumentRequestsByApplication } from "@/redux/actions/notificationActions"
import { useParams } from "react-router"
import { Card, CardContent } from "../ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table"
import { Button } from "../ui/button"
import { Trash2, Eye } from "lucide-react"
import { useDispatch, useSelector } from "react-redux"
import type { AppDispatch, RootState } from "@/redux/store"
import type { ApplicationFiles } from "@/types/applicationTypes"
import { deleteApplicationFile, getApplicationByApplicationId, uploadApplicationDocuments } from "@/redux/actions/applicationActions"
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
    const { applicationId: routeApplicationId } = useParams<{ applicationId: string }>()
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const [uploadedFiles, setUploadedFiles] = useState<ApplicationFiles[]>([])
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const [isPDFModalOpen, setIsPDFModalOpen] = useState(false)
    const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null)
    const [pdfFileName, setPdfFileName] = useState<string>("")
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    const { data: applicationData } = useSelector(
        (state: RootState) => state.applicationDetail
    )
    const { loading: uploadLoading } = useSelector(
        (state: RootState) => state.uploadDocuments
    )
    const dispatch: AppDispatch = useDispatch()

    const effectiveApplicationId = applicationId ?? routeApplicationId

    // Keep cached first paint, then always refresh detail once for this application
    // so `files` are present even when list-cache rows were partial.
    const lastFetchedApplicationIdRef = useRef<string | null>(null)
    useEffect(() => {
        if (!effectiveApplicationId) return
        const requestedKey = String(effectiveApplicationId)
        if (lastFetchedApplicationIdRef.current === requestedKey) return
        lastFetchedApplicationIdRef.current = requestedKey

        // Treat this as business applicationId (numeric id in route and preview sheet).
        dispatch(getApplicationByApplicationId(requestedKey))
        void dispatch(getDocumentRequestsByApplication(requestedKey))
    }, [effectiveApplicationId, dispatch])

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

    }, [applicationData])

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
        const refreshKey = applicationData.applicationId ?? effectiveApplicationId
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
            const refreshKey = applicationData.applicationId ?? effectiveApplicationId
            if (refreshKey != null) {
                await dispatch(getApplicationByApplicationId(refreshKey))
            }

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

    return (
        <Card
            className={`rounded-lg box-border p-0 border py-0 gap-0 shadow-[0_12px_40px_-12px_rgba(15,23,42,0.14),0_4px_14px_-4px_rgba(15,23,42,0.08)] dark:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)] ${isDark ? "border-[#374151] bg-[#141517]" : "border-slate-200/90 bg-card"
                }`}
        >
            <CardContent className="p-0">
                <div className="px-6 pt-4">
                    <RequestedDocumentsPanel
                        applicationLookupId={applicationData?.applicationId ?? effectiveApplicationId ?? null}
                        applicationUuid={applicationData?._id ? String(applicationData._id) : null}
                        businessApplicationId={applicationData?.applicationId ?? effectiveApplicationId ?? null}
                        readOnly={readOnly}
                    />
                </div>
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