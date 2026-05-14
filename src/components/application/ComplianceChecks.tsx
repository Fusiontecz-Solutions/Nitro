import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { X, Check } from "lucide-react";
import ProvideDetailsModal from "./ProvideDetailsModal";
import { useSelector, useDispatch } from "react-redux";
import type { RootState, AppDispatch } from "@/redux/store";
import type { user } from "@/redux/slices/authSlice";
import MyNotes from "./MyNotes";
import { useTheme } from "@/context/ThemeContext";
import { getComplianceChecks, createOrUpdateComplianceCheck } from "@/redux/actions/complianceCheckActions";
import { toast } from "react-toastify";
import type { ComplianceCheck } from "@/types/complianceCheckTypes";

interface CheckQuestion {
    id: string;
    question: string;
    answer?: "yes" | "no";
    reason?: string;
    signature?: string;
    date?: string;
}

const ComplianceChecks = () => {
    const dispatch = useDispatch<AppDispatch>();
    const [openModalQuestionId, setOpenModalQuestionId] = useState<string | null>(null);
    const [user, setUser] = useState<user>();
    const { loading, data } = useSelector((state: RootState) => state.login);
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    // Get application data from Redux
    const applicationData = useSelector((state: RootState) => state.applicationDetail.data);
    const applicationId = applicationData?._id;

    // Get compliance checks from Redux
    const { data: complianceChecksData, loading: complianceChecksLoading } = useSelector(
        (state: RootState) => state.complianceChecks
    );
    const { loading: createOrUpdateLoading } = useSelector(
        (state: RootState) => state.createOrUpdateComplianceCheck
    );

    useEffect(() => {
        setUser(data?.user);
        if (!data?.user) {
            const storedUser = localStorage.getItem("user");
            if (storedUser) {
                setUser(JSON.parse(storedUser));
            }
        }
    }, [data, loading]);

    // Default questions
    const defaultQuestions: CheckQuestion[] = [
        {
            id: "1",
            question: "Is the client currently involved in any legal cases?",
        },
        {
            id: "2",
            question: "Any Recent default ? If yes, please take details",
        },
        {
            id: "3",
            question: "Is merchant stacked in recent month? If yes, share details",
        },
        {
            id: "4",
            question: "Was merchant funded in recent month? If yes, share details",
        },
        {
            id: "5",
            question: "Any negative google check or news? If yes, share details",
        },
        {
            id: "6",
            question: "Has the client filed for bankruptcy in the past 7 years?",
        },
    ];

    // Fetch compliance checks when application is available
    useEffect(() => {
        if (applicationId) {
            dispatch(getComplianceChecks({ application: applicationId as string }));
        }
    }, [applicationId, dispatch]);

    // Merge default questions with API data
    const [questions, setQuestions] = useState<CheckQuestion[]>(defaultQuestions);

    useEffect(() => {
        if (complianceChecksData && Array.isArray(complianceChecksData)) {
            // Create a map of existing compliance checks by question
            const checksMap = new Map<string, ComplianceCheck>();
            complianceChecksData.forEach((check) => {
                checksMap.set(check.question, check);
            });

            // Merge default questions with API data
            const mergedQuestions = defaultQuestions.map((q) => {
                const existingCheck = checksMap.get(q.question);
                if (existingCheck) {
                    return {
                        id: existingCheck._id,
                        question: existingCheck.question,
                        answer: existingCheck.answer,
                        reason: existingCheck.reason,
                        signature: existingCheck.signature,
                        date: existingCheck.date,
                    };
                }
                return q;
            });

            setQuestions(mergedQuestions);
        } else if (!complianceChecksLoading) {
            // If no data and not loading, use default questions
            setQuestions(defaultQuestions);
        }
    }, [complianceChecksData, complianceChecksLoading]);

    const handleAnswerChange = useCallback(async (id: string, answer: "yes" | "no", questionText: string) => {
        if (!applicationId) {
            toast.error('Application not found');
            return;
        }

        if (answer === "yes") {
            // Open modal for "Yes" answer
            setOpenModalQuestionId(id);
        } else {
            // For "No" answer, save immediately
            try {
                await dispatch(createOrUpdateComplianceCheck({
                    question: questionText,
                    answer: "no",
                    application: applicationId as string,
                })).unwrap();

                // Update local state
                setQuestions((prev) =>
                    prev.map((q) =>
                        q.id === id || q.question === questionText
                            ? {
                                  ...q,
                                  answer: "no",
                                  reason: undefined,
                                  signature: undefined,
                                  date: undefined,
                              }
                            : q
                    )
                );

                // Refresh compliance checks
                dispatch(getComplianceChecks({ application: applicationId as string }));
            } catch (error: any) {
                console.error('Save compliance check error:', error);
                toast.error(error || 'Failed to save compliance check');
            }
        }
    }, [applicationId, dispatch]);

    const handleSaveDetails = useCallback(async (questionId: string, details: string) => {
        if (!applicationId) {
            toast.error('Application not found');
            return;
        }

        const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        const userName = user?.firstName && user?.lastName 
            ? `${user.firstName} ${user.lastName}`.replace(/\b\w/g, (l) => l.toUpperCase())
            : "John Smith"; // Fallback name

        // Find the question text
        const question = questions.find(q => q.id === questionId);
        if (!question) {
            toast.error('Question not found');
            return;
        }

        try {
            await dispatch(createOrUpdateComplianceCheck({
                question: question.question,
                answer: "yes",
                reason: details,
                signature: userName,
                date: currentDate,
                application: applicationId as string,
            })).unwrap();

            // Update local state
            setQuestions((prev) =>
                prev.map((q) =>
                    q.id === questionId
                        ? {
                              ...q,
                              answer: "yes",
                              reason: details,
                              signature: userName,
                              date: currentDate,
                          }
                        : q
                )
            );

            // Refresh compliance checks
            dispatch(getComplianceChecks({ application: applicationId as string }));
            toast.success('Compliance check saved successfully');
        } catch (error: any) {
            console.error('Save compliance check error:', error);
            toast.error(error || 'Failed to save compliance check');
        }

        setOpenModalQuestionId(null);
    }, [applicationId, dispatch, questions, user]);


    const getBorderColor = (answer?: "yes" | "no") => {
        if (answer === "yes") return "border-[#DC331D]";
        if (answer === "no") return "border-[#16A34A]";
        return isDark ? "border-[#363638]" : "border-[#FDFDFD]";
    };

    const getRadioButtonClasses = (isSelected: boolean, answer: "yes" | "no") => {
        if (answer === "yes") {
            return isSelected
                ? "border-[#DC331D] bg-[#DC331D] text-white"
                : isDark 
                    ? "border-gray-600 bg-muted text-gray-400 hover:border-gray-500" 
                    : "border-gray-300 bg-white text-gray-400 hover:border-gray-400";
        } else {
            return isSelected
                ? "border-[#16A34A] bg-[#16A34A] text-white"
                : isDark 
                    ? "border-gray-600 bg-muted text-gray-400 hover:border-gray-500" 
                    : "border-gray-300 bg-white text-gray-400 hover:border-gray-400";
        }
    };

    // Calculate progress statistics
    const totalQuestions = questions.length;
    const completedChecks = questions.filter(q => q.answer !== undefined).length;
    const flagsRaised = questions.filter(q => q.answer === "yes").length;
    const noAnswers = questions.filter(q => q.answer === "no").length;
    const progressPercentage = totalQuestions > 0 ? Math.round((completedChecks / totalQuestions) * 100) : 0;

    // Calculate overall risk based on flags vs no answers
    const getOverallRisk = () => {
        if (completedChecks === 0) return { level: 'Not Assessed', color: 'text-gray-500' };
        if (flagsRaised > noAnswers) return { level: 'High Risk', color: 'text-red-600' };
        if (flagsRaised === noAnswers) return { level: 'Medium Risk', color: 'text-yellow-600' };
        return { level: 'Low Risk', color: 'text-green-600' };
    };

    const overallRisk = getOverallRisk();

    return (
        <div className="flex flex-col gap-6 w-full">
            {/* Compliance Checks Progress Section */}
            <Card className="gap-2 w-full border border-[#FDFDFD] shadow-[0px_4px_20px_0px_#00000005] rounded-sm px-6 py-4">
                <div className="flex items-center justify-between">
                    <h3 className={`text-base font-[600] font-roboto text-[#374151] ${isDark ? 'text-gray-200' : 'text-[#374151]'}`}>Compliance Checks Progress</h3>
                    <span className={`font-[600] font-roboto text-[#374151] ${isDark ? 'text-gray-200' : 'text-[#374151]'}`}>{progressPercentage}%</span>
                </div>
                
                {/* Progress Bar */}
                <div className="relative w-full">
                    <div className={`w-full ${isDark ? 'bg-muted' : 'bg-[#E9EDF5]'} rounded-full h-2.5`}>
                        <div 
                            className="h-full bg-[#276D9C] rounded-full transition-all duration-300"
                            style={{ width: `${progressPercentage}%` }}
                        ></div>
                    </div>
                </div>
                
                {/* Details below Progress Bar */}
                <div className="flex items-center justify-between">
                    <p className={`text-xs font-[400] font-roboto ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {completedChecks} of {totalQuestions} checks completed
                    </p>
                    <p className="text-xs font-medium text-[#F55641]">
                        {flagsRaised} Flag{flagsRaised !== 1 ? 's' : ''} Raised
                    </p>
                </div>
            </Card>

            <div className="flex gap-6 w-full">
                <Card className={`bg-transparent w-[85%] flex-2 shadow-none border-none py-0 px-0 ${isDark ? 'bg-transparent' : ''}`}>
                    <div className={`divide-y ${isDark ? 'divide-[#363638]' : 'divide-[#D1D5DB]'} flex flex-col gap-6 `}>
                        {questions.map((question, index) => (
                            <div
                                key={question.id}
                                className={`px-6 py-4 rounded-sm ${isDark ? 'bg-card' : 'bg-white'} ${getBorderColor(question.answer)} shadow-[0px_4px_20px_0px_#00000005] rounded-lg border-2`}
                            >
                                <p className={`text-sm font-roboto font-medium ${isDark ? 'text-gray-200' : 'text-[#374151]'} mb-4`}>
                                    {question.question}
                                </p>

                                {/* Yes/No Radio Buttons */}
                                <div className="flex items-center gap-6 mb-4">
                                    {/* Yes Button */}
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <button type="button"
                                            onClick={() => handleAnswerChange(question.id, "yes", question.question)}
                                            disabled={createOrUpdateLoading}
                                            className={`px-3 py-1.5 flex items-center gap-2 rounded-sm border-2 transition-all ${getRadioButtonClasses(
                                                question.answer === "yes",
                                                "yes"
                                            )}`}
                                        >
                                            <div
                                                className={`w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center ${
                                                    question.answer === "yes"
                                                        ? "border-white bg-transparent"
                                                        : isDark ? "border-gray-600 bg-muted" : "border-gray-300 bg-white"
                                                }`}
                                            >
                                                {/* {question.answer === "yes" && ( */}
                                                    <X className="h-3 w-3 text-white" />
                                                {/* )} */}
                                            </div>
                                            <span className={`text-sm font-medium ${question.answer === "yes" ? 'text-white' : (!isDark ? 'text-gray-400' : '')}`}>Yes</span>
                                        </button>
                                    </label>

                                    {/* No Button */}
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <button type="button"
                                            onClick={() => handleAnswerChange(question.id, "no", question.question)}
                                            disabled={createOrUpdateLoading}
                                            className={`px-3 py-1.5 flex items-center gap-2 rounded-sm border-2 transition-all ${getRadioButtonClasses(
                                                question.answer === "no",
                                                "no"
                                            )} `
                                        }
                                        >
                                            <div
                                                className={`w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center ${
                                                    question.answer === "no"
                                                        ? "border-white bg-transparent"
                                                        : isDark ? "border-gray-600 bg-muted" : "border-gray-300 bg-white"
                                                }`}
                                            >
                                                {/* {question.answer === "no" && ( */}
                                                    <Check className="h-3 w-3 text-white" />
                                                {/* )} */}
                                            </div>
                                            <span className={`text-sm font-medium ${question.answer === "no" ? 'text-white' : (!isDark ? 'text-gray-400' : '')}`}>No</span>
                                        </button>
                                    </label>
                                </div>

                            {/* Reason Display (only when Yes is selected and reason exists) */}
                            {question.answer === "yes" && question.reason && (
                                <div >
                                    <div className={`border ${isDark ? 'border-gray-700' : 'border-[#D1D5DB]'} rounded-sm p-4`}>
                                        <p className={`text-sm font-medium font-roboto ${isDark ? 'text-red-400' : 'text-[#AF2E1D]'} mb-2`}>Reason:</p>
                                        <p className={`text-sm font-roboto ${isDark ? 'text-gray-200' : 'text-gray-900'} font-medium mb-2 whitespace-pre-wrap`}>
                                            {question.reason}
                                        </p>
                                        {question.signature && question.date && (
                                            <p className={`text-xs font-roboto ${isDark ? 'text-gray-300' : 'text-black'}`}>
                                                {question.signature} • {question.date}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                            </div>
                        ))}
                    </div>

                    {/* Provide Details Modal */}
                    {openModalQuestionId && (
                        <ProvideDetailsModal
                            open={openModalQuestionId !== null}
                            onOpenChange={(open) => {
                                if (!open) setOpenModalQuestionId(null);
                            }}
                            question={
                                questions.find((q) => q.id === openModalQuestionId)?.question || ""
                            }
                            onSave={(details) => handleSaveDetails(openModalQuestionId, details)}
                            initialDetails={
                                questions.find((q) => q.id === openModalQuestionId)?.reason || ""
                            }
                        />
                    )}
                </Card>
                
                <div className="flex flex-col gap-6 flex-1 w-full">
                    <MyNotes/>
                    
                    {/* Risk Summary Card */}
                    <Card className={` border border-[#FDFDFD] shadow-[0px_4px_20px_0px_#00000005] rounded-sm ${isDark ? 'bg-card' : 'bg-white'} overflow-hidden pt-0 pb-2 gap-2 px-0`}>
                        {/* Header Section */}
                        <div className={`${isDark ? 'bg-muted' : 'bg-[#F9FAFD]'} px-4 py-3`}>
                            <h3 className={`text-base font-roboto font-semibold ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>Risk Summery</h3>
                        </div>
                        
                        {/* Main Content */}
                        <div className="px-0 py-2 space-y-4">
                            {/* Overall Risk */}
                            <div className="flex justify-between items-center px-4">
                                <span className={`text-sm font-roboto ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Overall Risk</span>
                                <span className={`text-sm font-roboto font-medium ${overallRisk.color}`}>{overallRisk.level}</span>
                            </div>
                            
                            {/* Credit Score */}
                            <div className="flex justify-between items-center px-4">
                                <span className={`text-sm font-roboto ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Credit Score</span>
                                <span className="text-sm font-roboto font-medium text-green-600">720 - Excellent</span>
                            </div>
                            
                            {/* Risk Grade */}
                            <div className="flex justify-between items-center px-4">
                                <span className={`text-sm font-roboto ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Risk Grade</span>
                                <span className="text-sm font-roboto font-medium text-green-600">B+</span>
                            </div>
                            
                            {/* Separator */}
                            <div className={`border-t ${isDark ? 'border-[#363638]' : 'border-[#D1D5DB]'} my-4`}></div>
                            
                            {/* Flag Section */}
                            <div className="px-4">
                                <span className="text-sm font-roboto font-bold text-red-600">
                                    {flagsRaised} Flag{flagsRaised !== 1 ? 's' : ''}
                                </span>
                                  <p className={`text-sm font-roboto ${isDark ? 'text-gray-300' : 'text-gray-700'} mt-1`}>Tax returns 
                                  pending CPA signature</p>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default ComplianceChecks;

