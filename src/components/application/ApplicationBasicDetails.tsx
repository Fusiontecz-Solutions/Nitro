import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import type { AppDispatch, RootState } from "@/redux/store";
import { useTheme } from "@/context/ThemeContext";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { updateClient } from "@/redux/actions/clientActions";
import { updateApplication } from "@/redux/actions/applicationActions";
import { toast } from "react-toastify";
import { Pencil } from "lucide-react";
import { normalizeRoleKey, resolveEffectiveRole } from "@/lib/sessionRole";

interface ApplicationBasicDetailsProps {
    /** When provided (e.g. on application-detail overview for agent), only show data for this application — no static values */
    applicationId?: string | null;
}

/**
 * Application notes can embed machine-managed sections such as
 * `[CONTRACT_VALUES] {...json...}` written by the Contract tab. Strip them so
 * the user-facing Application Note only shows free-form text. Sections are
 * separated by a blank line and start with `[LABEL]` on its own line.
 */
const STRUCTURED_SECTION_REGEX =
    /(?:\n\n)?\[[^\]\n]+\]\s*\n[\s\S]*?(?=(?:\n\n\[[^\]\n]+\]\s*\n)|$)/g;

const stripStructuredSections = (note: string): string =>
    String(note || "").replace(STRUCTURED_SECTION_REGEX, "").trim();

/**
 * Re-attach any structured sections (e.g. `[CONTRACT_VALUES] {...}`) from the
 * original backend note onto an edited user-visible note, so saving from the
 * basic-details form preserves data owned by the Contract tab.
 */
const mergeUserNoteWithStructuredSections = (
    userNote: string,
    originalNote: string,
): string => {
    const trimmedUser = String(userNote || "").trim();
    const matches = String(originalNote || "").match(STRUCTURED_SECTION_REGEX);
    if (!matches || matches.length === 0) return trimmedUser;
    const structured = matches
        .map((block) => block.replace(/^\n+/, ""))
        .join("\n\n")
        .trim();
    if (!structured) return trimmedUser;
    return trimmedUser ? `${trimmedUser}\n\n${structured}` : structured;
};

const ApplicationBasicDetails = ({ applicationId }: ApplicationBasicDetailsProps) => {
    const dispatch: AppDispatch = useDispatch();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    const { loading: fetchLoading, data: applicationData } = useSelector(
        (state: RootState) => state.applicationDetail
    );
    const loginUser = useSelector((state: RootState) => state.login.data?.user);
    const [saving, setSaving] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const normalizedRole = useMemo(
        () => normalizeRoleKey(resolveEffectiveRole(loginUser)),
        [loginUser]
    );
    const canEditBasicDetails =
        normalizedRole === "AGENT" || normalizedRole === "SUPER_ADMIN";

    const data = applicationData as any;
    const clientId = String(data?.client?.id ?? "");
    const targetApplicationId = String(applicationId || data?.id || data?.applicationId || "");

    const toDateInput = (raw: unknown) => {
        if (!raw) return "";
        const d = new Date(String(raw));
        return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    };

    const [form, setForm] = useState({
        businessName: "",
        businessEmail: "",
        businessNumber: "",
        incorporationDate: "",
        businessEntityType: "",
        website: "",
        incorporationState: "",
        monthlyRevenue: "",
        einNumber: "",
        businessAddress1: "",
        businessCity: "",
        businessState: "",
        businessZipCode: "",
        ownerFirstName: "",
        ownerLastName: "",
        ownerEmail: "",
        ownerMobileNumber: "",
        ownerDateOfBirth: "",
        ownerSsn: "",
        ownerFicoScore: "",
        ownerOwnershipPercentage: "",
        ownerAddress1: "",
        ownerCity: "",
        ownerState: "",
        ownerZipCode: "",
        loanAmount: "",
        note: "",
    });

    useEffect(() => {
        const app = applicationData as any;
        setForm({
            businessName: String(app?.client?.business?.name ?? ""),
            businessEmail: String(app?.client?.business?.email ?? ""),
            businessNumber: String(app?.client?.business?.number ?? ""),
            incorporationDate: toDateInput(app?.client?.business?.incorporationDate),
            businessEntityType: String(app?.client?.business?.businessEntityType ?? ""),
            website: String(app?.client?.business?.website ?? ""),
            incorporationState: String(app?.client?.business?.incorporationState ?? ""),
            monthlyRevenue: String(app?.client?.business?.monthlyRevenue ?? ""),
            einNumber: String(app?.client?.business?.einNumber ?? ""),
            businessAddress1: String(app?.client?.business?.address?.address1 ?? ""),
            businessCity: String(app?.client?.business?.address?.city ?? ""),
            businessState: String(app?.client?.business?.address?.state ?? ""),
            businessZipCode: String(app?.client?.business?.address?.zipCode ?? ""),
            ownerFirstName: String(app?.client?.owner?.firstName ?? ""),
            ownerLastName: String(app?.client?.owner?.lastName ?? ""),
            ownerEmail: String(app?.client?.owner?.email ?? ""),
            ownerMobileNumber: String(app?.client?.owner?.mobileNumber ?? ""),
            ownerDateOfBirth: toDateInput(app?.client?.owner?.dateOfBirth),
            ownerSsn: String(app?.client?.owner?.ssn ?? ""),
            ownerFicoScore: String(app?.client?.owner?.ficoScore ?? ""),
            ownerOwnershipPercentage: String(app?.client?.owner?.ownershipPercentage ?? ""),
            ownerAddress1: String(app?.client?.owner?.address?.address1 ?? ""),
            ownerCity: String(app?.client?.owner?.address?.city ?? ""),
            ownerState: String(app?.client?.owner?.address?.state ?? ""),
            ownerZipCode: String(app?.client?.owner?.address?.zipCode ?? ""),
            loanAmount: String(app?.loanAmount ?? ""),
            note: stripStructuredSections(String(app?.note ?? "")),
        });
    }, [applicationData]);

    const updateField = (key: keyof typeof form, value: string) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const displayValue = (key: keyof typeof form) => {
        const value = String(form[key] ?? "").trim();
        if (!value) return "-";
        if (key.toLowerCase().includes("date")) {
            const d = new Date(value);
            return Number.isNaN(d.getTime())
                ? "-"
                : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        }
        return value;
    };

    const fields = useMemo(
        () => ({
            business: [
                ["Business Name", "businessName"],
                ["Business Email", "businessEmail"],
                ["Business Number", "businessNumber"],
                ["Incorporation date", "incorporationDate"],
                ["Type of business entity", "businessEntityType"],
                ["Website", "website"],
                ["Incorporation State", "incorporationState"],
                ["Monthly Revenue", "monthlyRevenue"],
                ["EIN Number", "einNumber"],
                ["Address 1", "businessAddress1"],
                ["City", "businessCity"],
                ["State", "businessState"],
                ["Zip Code", "businessZipCode"],
                ["Loan Amount", "loanAmount"],
                ["Application Note", "note"],
            ] as const,
            owner: [
                ["First Name", "ownerFirstName"],
                ["Last Name", "ownerLastName"],
                ["Email", "ownerEmail"],
                ["Mobile Number", "ownerMobileNumber"],
                ["Date of Birth", "ownerDateOfBirth"],
                ["Social Security Number (SSN)", "ownerSsn"],
                ["FICO Score", "ownerFicoScore"],
                ["Ownership Percentage", "ownerOwnershipPercentage"],
                ["Address 1", "ownerAddress1"],
                ["City", "ownerCity"],
                ["State", "ownerState"],
                ["Zip Code", "ownerZipCode"],
            ] as const,
        }),
        []
    );

    const saveAll = async () => {
        if (!canEditBasicDetails) {
            toast.error("You are not allowed to edit application basic details.");
            return;
        }
        if (!clientId) {
            toast.error("Client ID not found for this application.");
            return;
        }
        if (!targetApplicationId) {
            toast.error("Application ID not found.");
            return;
        }
        setSaving(true);
        try {
            await dispatch(
                updateClient({
                    id: clientId,
                    data: {
                        business: {
                            name: form.businessName,
                            email: form.businessEmail,
                            number: form.businessNumber,
                            website: form.website,
                            incorporationDate: form.incorporationDate || null,
                            incorporationState: form.incorporationState,
                            businessEntityType: form.businessEntityType,
                            einNumber: form.einNumber,
                            monthlyRevenue: form.monthlyRevenue === "" ? null : Number(form.monthlyRevenue),
                            address: {
                                address1: form.businessAddress1,
                                city: form.businessCity,
                                state: form.businessState,
                                zipCode: form.businessZipCode,
                            },
                        },
                        owner: {
                            firstName: form.ownerFirstName,
                            lastName: form.ownerLastName,
                            email: form.ownerEmail,
                            mobileNumber: form.ownerMobileNumber,
                            dateOfBirth: form.ownerDateOfBirth || null,
                            ssn: form.ownerSsn,
                            ficoScore: form.ownerFicoScore === "" ? null : Number(form.ownerFicoScore),
                            ownershipPercentage:
                                form.ownerOwnershipPercentage === ""
                                    ? null
                                    : Number(form.ownerOwnershipPercentage),
                            address: {
                                address1: form.ownerAddress1,
                                city: form.ownerCity,
                                state: form.ownerState,
                                zipCode: form.ownerZipCode,
                            },
                        },
                    } as any,
                })
            ).unwrap();

            await dispatch(
                updateApplication({
                    id: targetApplicationId,
                    data: {
                        loanAmount: form.loanAmount === "" ? null : Number(form.loanAmount),
                        note: mergeUserNoteWithStructuredSections(
                            form.note,
                            String((applicationData as any)?.note ?? ""),
                        ),
                    } as any,
                })
            ).unwrap();

            toast.success("Application details updated successfully.");
            setIsEditMode(false);
        } catch (error: any) {
            toast.error(error?.message || String(error) || "Failed to update details.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <Card className={`gap-0 border shadow-md dark:shadow-lg p-0 rounded-b-md pb-3 ${isDark ? "bg-[#141517] border-[#374151]" : "border-[#FDFDFD]"}`}>
                <CardHeader className="pb-0 p-0">
                    <div className={`rounded-t-sm text-base font-[600] font-roboto px-6 py-3 flex items-center justify-between ${isDark ? "text-white bg-[#2A2B2F]" : "text-[#374151] bg-[#F9FAFD]"}`}>
                        <CardTitle>Business Profile</CardTitle>
                        {!isEditMode ? (
                            canEditBasicDetails ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setIsEditMode(true)}
                                disabled={fetchLoading || saving}
                            >
                                <Pencil className="h-4 w-4" />
                                Edit
                            </Button>
                            ) : null
                        ) : (
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setIsEditMode(false);
                                        const app = applicationData as any;
                                        setForm({
                                            businessName: String(app?.client?.business?.name ?? ""),
                                            businessEmail: String(app?.client?.business?.email ?? ""),
                                            businessNumber: String(app?.client?.business?.number ?? ""),
                                            incorporationDate: toDateInput(app?.client?.business?.incorporationDate),
                                            businessEntityType: String(app?.client?.business?.businessEntityType ?? ""),
                                            website: String(app?.client?.business?.website ?? ""),
                                            incorporationState: String(app?.client?.business?.incorporationState ?? ""),
                                            monthlyRevenue: String(app?.client?.business?.monthlyRevenue ?? ""),
                                            einNumber: String(app?.client?.business?.einNumber ?? ""),
                                            businessAddress1: String(app?.client?.business?.address?.address1 ?? ""),
                                            businessCity: String(app?.client?.business?.address?.city ?? ""),
                                            businessState: String(app?.client?.business?.address?.state ?? ""),
                                            businessZipCode: String(app?.client?.business?.address?.zipCode ?? ""),
                                            ownerFirstName: String(app?.client?.owner?.firstName ?? ""),
                                            ownerLastName: String(app?.client?.owner?.lastName ?? ""),
                                            ownerEmail: String(app?.client?.owner?.email ?? ""),
                                            ownerMobileNumber: String(app?.client?.owner?.mobileNumber ?? ""),
                                            ownerDateOfBirth: toDateInput(app?.client?.owner?.dateOfBirth),
                                            ownerSsn: String(app?.client?.owner?.ssn ?? ""),
                                            ownerFicoScore: String(app?.client?.owner?.ficoScore ?? ""),
                                            ownerOwnershipPercentage: String(app?.client?.owner?.ownershipPercentage ?? ""),
                                            ownerAddress1: String(app?.client?.owner?.address?.address1 ?? ""),
                                            ownerCity: String(app?.client?.owner?.address?.city ?? ""),
                                            ownerState: String(app?.client?.owner?.address?.state ?? ""),
                                            ownerZipCode: String(app?.client?.owner?.address?.zipCode ?? ""),
                                            loanAmount: String(app?.loanAmount ?? ""),
                                            note: stripStructuredSections(String(app?.note ?? "")),
                                        });
                                    }}
                                    disabled={saving}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => void saveAll()}
                                    disabled={fetchLoading || saving}
                                >
                                    {saving ? "Saving..." : "Save"}
                                </Button>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="pt-0 px-6">
                    <div className="space-y-2">
                        {fields.business.map(([label, key], index) => (
                            <div
                                key={index}
                                className="grid grid-cols-2 gap-4 py-1 font-roboto"
                            >
                                <span className={`text-sm font-medium ${isDark ? "text-[#5AACEA]" : "text-[#276D9C]"}`}>{label}</span>
                                {isEditMode ? (
                                    <Input
                                        type={key.toLowerCase().includes("date") ? "date" : key.toLowerCase().includes("email") ? "email" : "text"}
                                        value={form[key]}
                                        onChange={(e) => updateField(key, e.target.value)}
                                        disabled={fetchLoading || saving}
                                    />
                                ) : (
                                    <span className={`text-sm ${isDark ? "text-white" : "text-[#4B5563]"}`}>
                                        {displayValue(key)}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card className={`gap-0 border shadow-md dark:shadow-lg p-0 rounded-b-md pb-3 ${isDark ? "bg-[#141517] border-[#374151]" : "border-[#FDFDFD]"}`}>
                <CardHeader className="pb-0 p-0">
                    <CardTitle className={`rounded-t-sm text-base font-[600] font-roboto px-6 py-3 ${isDark ? "text-white bg-[#2A2B2F]" : "text-[#374151] bg-[#F9FAFD]"}`}>
                        Business Owner Details
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 px-6">
                    <div className="space-y-2">
                        {fields.owner.map(([label, key], index) => (
                            <div
                                key={index}
                                className="grid grid-cols-2 gap-4 py-1 font-roboto"
                            >
                                <span className={`text-sm font-medium ${isDark ? "text-[#5AACEA]" : "text-[#276D9C]"}`}>{label}</span>
                                {isEditMode ? (
                                    <Input
                                        type={key.toLowerCase().includes("date") ? "date" : key.toLowerCase().includes("email") ? "email" : "text"}
                                        value={form[key]}
                                        onChange={(e) => updateField(key, e.target.value)}
                                        disabled={fetchLoading || saving}
                                    />
                                ) : (
                                    <span className={`text-sm ${isDark ? "text-white" : "text-[#4B5563]"}`}>
                                        {displayValue(key)}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default ApplicationBasicDetails;