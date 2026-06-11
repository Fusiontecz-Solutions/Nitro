import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router"
import { Card, CardContent } from "../ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table"
import { Button } from "../ui/button"
import { Trash2, Eye, FileUp } from "lucide-react"
import { useDispatch, useSelector } from "react-redux"
import type { AppDispatch, RootState } from "@/redux/store"
import type { ApplicationFiles } from "@/types/applicationTypes"
import { deleteApplicationFile, getApplicationByApplicationId, getApplicationById, uploadApplicationDocuments } from "@/redux/actions/applicationActions"
import { hydrateApplicationDetailFromCache } from "@/redux/slices/applicationSlice"
import { toast } from "react-toastify"
import { useTheme } from "@/context/ThemeContext"
import PDFViewerDocsModal from "./PDFViewerDocsModal"
import { formatDateTimeUS, cn } from "@/lib/utils"
import { invalidateApplicationDetailCache } from "@/lib/applicationDetailCache"
import { isNumericApplicationRouteParam } from "@/lib/applicationRouteMatch"

type UploadedDocumentsProps = {
    applicationId?: string
    /** Hide upload/delete (e.g. OPERATIONS view-only). */
    readOnly?: boolean
}

type PendingFile = {
    id: string
    file: File
}

const UploadedDocuments = ({
    applicationId,
    readOnly = false,
}: UploadedDocumentsProps) => {
    const { applicationId: routeApplicationId } = useParams<{ applicationId: string }>()
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
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

    const applicationMongoId = useMemo(() => {
        const id = applicationData?._id ?? (applicationData as { id?: string } | null)?.id
        return id != null ? String(id) : null
    }, [applicationData])

    const serverUploadedFiles: ApplicationFiles[] = useMemo(
        () => (Array.isArray(applicationData?.files) ? applicationData.files : []),
        [applicationData?.files],
    )

    const refreshApplicationDetail = useCallback(async () => {
        if (!effectiveApplicationId) return
        const requestedKey = String(effectiveApplicationId)
        invalidateApplicationDetailCache(requestedKey)
        if (isNumericApplicationRouteParam(requestedKey)) {
            await dispatch(getApplicationByApplicationId(requestedKey))
        } else {
            await dispatch(getApplicationById(requestedKey))
        }
    }, [dispatch, effectiveApplicationId])

    // Always load full application detail (incl. files) — list-cache rows are often partial.
    useEffect(() => {
        void refreshApplicationDetail()
    }, [refreshApplicationDetail])

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
        if (!applicationMongoId) {
            toast.error("Application ID not found")
            return
        }

        await dispatch(deleteApplicationFile({ applicationId: applicationMongoId, fileId: id }))

        await refreshApplicationDetail()

        toast.success("File deleted successfully")
    }

    // Handle local file selection (multiple)
    const handleSelectFiles = (files: FileList | null) => {
        if (!files || files.length === 0) return
        const newFiles: PendingFile[] = Array.from(files).map((file) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            file,
        }))
        setPendingFiles((prev) => [...prev, ...newFiles])
    }

    const handleRemovePendingFile = (id: string) => {
        setPendingFiles((prev) => prev.filter((entry) => entry.id !== id))
    }

    const handleOpenFilePicker = () => {
        fileInputRef.current?.click()
    }

    // Upload selected documents for this application
    const handleUploadSelectedFiles = async () => {
        if (!applicationMongoId) {
            toast.error("Application ID not found")
            return
        }
        if (pendingFiles.length === 0) {
            toast.warning("Please select one or more documents to upload")
            return
        }

        try {
            const result = await dispatch(
                uploadApplicationDocuments({
                    id: applicationMongoId,
                    files: pendingFiles.map((entry) => entry.file),
                })
            ).unwrap()

            const updatedApplication =
                (result as { data?: typeof applicationData })?.data ?? result
            if (updatedApplication && typeof updatedApplication === "object") {
                dispatch(
                    hydrateApplicationDetailFromCache({
                        success: true,
                        data: updatedApplication,
                    }),
                )
            }

            toast.success("Documents uploaded successfully")
            setPendingFiles([])
            if (fileInputRef.current) {
                fileInputRef.current.value = ""
            }

            await refreshApplicationDetail()
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
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                    handleSelectFiles(e.target.files)
                                    e.target.value = ""
                                }}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleOpenFilePicker}
                                className="h-8 px-3 text-xs font-medium cursor-pointer shadow-sm"
                            >
                                <FileUp className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                                Choose files
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={handleUploadSelectedFiles}
                                disabled={pendingFiles.length === 0 || uploadLoading}
                                className="h-8 px-3 text-xs font-medium bg-[#276D9C] hover:bg-[#276D9C] text-white cursor-pointer shadow-md"
                            >
                                {uploadLoading ? "Uploading..." : "Upload"}
                            </Button>
                        </div>
                    )}
                </div>
                {!readOnly && pendingFiles.length > 0 && (
                    <p className={`px-6 pb-2 text-xs font-roboto ${isDark ? "text-gray-300" : "text-gray-600"
                        }`}>
                        {pendingFiles.length} document(s) ready to upload — remove any you do not want before clicking Upload.
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
                            {pendingFiles.length === 0 && serverUploadedFiles.length === 0 ? (
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
                                        No documents uploaded
                                    </TableCell>
                                </TableRow>
                            ) : (
                                <>
                                    {!readOnly &&
                                        pendingFiles.map((entry, rowIdx) => (
                                            <TableRow
                                                key={entry.id}
                                                className={cn(
                                                    'border-b transition-colors hover:bg-accent',
                                                    isDark ? 'border-[#374151]' : 'border-[#ECEFF5]',
                                                    rowIdx % 2 ? 'bg-muted/50' : '',
                                                )}
                                            >
                                                <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-foreground')}>
                                                    <span className="inline-flex items-center gap-2">
                                                        {entry.file.name}
                                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                                            Pending
                                                        </span>
                                                    </span>
                                                </TableCell>
                                                <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-foreground')}>
                                                    {formatFileSize(entry.file.size)}
                                                </TableCell>
                                                <TableCell className={cn('text-[0.85rem] py-2 px-6 font-poppins text-muted-foreground')}>
                                                    —
                                                </TableCell>
                                                <TableCell className="text-left py-3 px-6">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            onClick={() => handleRemovePendingFile(entry.id)}
                                                            className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 h-4 w-4 py-0 px-2"
                                                            title="Remove file"
                                                        >
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    {serverUploadedFiles.map((file, rowIdx) => {
                                        const fileId = file._id ?? (file as { id?: string }).id ?? ""
                                        return (
                                            <TableRow
                                                key={fileId || `${file.originalName}-${rowIdx}`}
                                                className={cn(
                                                    'border-b transition-colors hover:bg-accent',
                                                    isDark ? 'border-[#374151]' : 'border-[#ECEFF5]',
                                                    (pendingFiles.length + rowIdx) % 2 ? 'bg-muted/50' : '',
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
                                                                onClick={() => handleDeleteFile(fileId)}
                                                                className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 h-4 w-4 py-0 px-2"
                                                                title="Delete file"
                                                                disabled={!fileId}
                                                            >
                                                                <Trash2 className="size-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </>
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