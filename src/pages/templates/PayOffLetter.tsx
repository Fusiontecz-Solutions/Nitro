// import {
//   Mail,
//   Phone,
//   Globe,
//   Info,
//   Calendar,
//   DollarSign,
//   Hash,
// } from "lucide-react";

// import { APP_LOGO_SRC, APP_LOGO_DARK_SRC } from "@/constants/appLogo";
// import lightBirdWatermark from "@/assets/image 6.png";
// import type {
//   TemplateComponentProps,
//   TemplateVariable,
// } from "./types";
// import { pick } from "./types";

// /** Merge fields surfaced by this template (preserves UI order). */
// export const PAY_OFF_LETTER_VARIABLES: TemplateVariable[] = [
//   { key: "letter_date", label: "Letter Date", placeholder: "May 20, 2024" },
//   { key: "recipient_name", label: "Recipient Name", placeholder: "Jorden Purnell" },
//   { key: "recipient_address_line1", label: "Recipient Address Line 1", placeholder: "123 Client Street" },
//   { key: "recipient_address_line2", label: "Recipient Address Line 2", placeholder: "City, State, 12345" },
//   { key: "account_number", label: "Account Number", placeholder: "1234567890" },
//   { key: "salutation_name", label: "Salutation Name", placeholder: "John Doe" },
//   { key: "payoff_amount", label: "Payoff Amount", placeholder: "$5,678.90" },
//   { key: "good_through_date", label: "Good Through Date", placeholder: "May 27, 2024" },
//   { key: "payment_company_name", label: "Payment Company Name", placeholder: "Your Company Name" },
//   { key: "payment_address_line1", label: "Payment Address Line 1", placeholder: "123 Business Street" },
//   { key: "payment_address_line2", label: "Payment Address Line 2", placeholder: "City, State, 12345" },
//   { key: "sender_name", label: "Sender Name", placeholder: "Your Name" },
// ];

// /** Fixed line under the sender name in payoff letter preview + email (not a merge field). */
// export const PAY_OFF_LETTER_SIGNATURE_TITLE = "Account Specialist";

// const v = PAY_OFF_LETTER_VARIABLES.reduce<Record<string, TemplateVariable>>(
//   (acc, variable) => {
//     acc[variable.key] = variable;
//     return acc;
//   },
//   {},
// );

// /** Same wordmark block as `ZeroBalanceLetter` (matches `payOffLetterEmailHtml` / design). */
// function BarclaysLogoMark() {
//   return (
//     <div className="relative h-28 w-[min(100%,24rem)] shrink-0 sm:h-32 sm:w-[28rem] md:h-36 md:w-[32rem]">
//       <img
//         src={APP_LOGO_SRC}
//         alt={APP_COMPANY_NAME}
//         className="absolute inset-0 h-full w-full object-contain object-left dark:hidden"
//       />
//       <img
//         src={APP_LOGO_DARK_SRC}
//         alt={APP_COMPANY_NAME}
//         className="absolute inset-0 hidden h-full w-full object-contain object-left dark:block"
//       />
//     </div>
//   );
// }

// export default function PayOffLetter({ values }: TemplateComponentProps) {
//   const letterDate = pick(values, v.letter_date);
//   const recipientName = pick(values, v.recipient_name);
//   const recipientAddress1 = pick(values, v.recipient_address_line1);
//   const recipientAddress2 = pick(values, v.recipient_address_line2);
//   const accountNumberFull = pick(values, v.account_number);
//   // "Re: Account Ending in …" gets the last 4 digits derived from the full
//   // account number, so we don't expose a redundant merge field. When the full
//   // value is the placeholder/label fallback, we mirror it (e.g. "Account Number").
//   const accountLastFour = (() => {
//     const raw = values[v.account_number.key]?.trim() ?? "";
//     if (!raw) return accountNumberFull;
//     const digits = raw.replace(/\D/g, "");
//     return digits.length >= 4 ? digits.slice(-4) : digits || accountNumberFull;
//   })();
//   const salutationName = pick(values, v.salutation_name);
//   const payoffAmount = pick(values, v.payoff_amount);
//   const goodThroughDate = pick(values, v.good_through_date);
//   const paymentCompany = pick(values, v.payment_company_name);
//   const paymentAddress1 = pick(values, v.payment_address_line1);
//   const paymentAddress2 = pick(values, v.payment_address_line2);
//   const senderName = pick(values, v.sender_name);

//   return (
//     <div className="max-w-4xl mx-auto my-10 border border-border bg-[#ffffff] text-card-foreground shadow-2xl font-sans relative overflow-x-clip overflow-y-visible">
//       <div className="relative z-[1] px-8 pb-0 pt-8">
//         <div className="flex flex-wrap items-start justify-between gap-8 pb-3">
//           <div className="flex min-w-0 flex-1 items-start">
//             <BarclaysLogoMark />
//           </div>

//           <div className="min-w-0 shrink-0 space-y-1 text-sm text-muted-foreground">
//             <div className="flex items-center gap-2">
//               <img
//                 src="https://res.cloudinary.com/dehrku8og/image/upload/v1778670411/93a71680f5d01ebd585f5de5fb897d0327fcab5d_nxclho.png"
//                 alt=""
//                 className="h-5 w-5 shrink-0 object-contain"
//               />
//               <span>651 N Broad St, Suite 201 Middletown, DE</span>
//             </div>
//             <div className="flex items-center gap-2">
//               <Phone size={14} className="shrink-0 text-blue-600 dark:text-sky-400" />
//               <span>845 - 746 - 0856</span>
//             </div>
//             <div className="flex items-center gap-2">
//               <Mail size={14} className="shrink-0 text-blue-600 dark:text-sky-400" />
//               <span>jorden@barclaysadvance.com</span>
//             </div>
//             <div className="flex items-center gap-2">
//               <Globe size={14} className="shrink-0 text-blue-600 dark:text-sky-400" />
//               <span>www.barclaysadvance.com</span>
//             </div>
//           </div>
//         </div>

//         <div className="flex w-full items-center gap-0" aria-hidden>
//           <div className="h-[3px] min-h-[3px] min-w-0 flex-1 bg-[#4a86cf] dark:bg-primary" />
//           <div className="flex shrink-0 items-center -ml-4 -space-x-2.5">
//             <div className="h-2 w-9 -skew-x-[26deg] bg-[#D8E6F5] dark:bg-sky-200/35" />
//             <div className="h-2 w-9 -skew-x-[26deg] bg-[#3F84D5] dark:bg-primary" />
//           </div>
//         </div>
//       </div>

//       <div className="relative isolate p-12">
//         <div
//           className="pointer-events-none absolute right-0 bottom-0 z-0 flex w-max max-w-none items-end justify-end"
//           aria-hidden
//         >
//           <img
//             src={lightBirdWatermark}
//             alt=""
//             className="h-[min(38rem,78vw)] w-auto max-w-none origin-bottom-right translate-x-1 -rotate-[16deg] object-contain object-bottom select-none sm:h-[min(40rem,72vw)] md:h-[min(44rem,65vw)] opacity-[0.68] contrast-[1.2] mix-blend-multiply brightness-[0.72] saturate-[0.9] drop-shadow-[0_2px_8px_rgba(15,23,42,0.14)] dark:mix-blend-normal dark:opacity-[0.76] dark:brightness-[0.92] dark:contrast-[1.08] dark:drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
//           />
//         </div>

//         <div className="relative z-10">
//           <h2 className="mb-10 text-center text-2xl font-bold tracking-tight text-blue-900 dark:text-sky-200">
//             Payoff Letter
//           </h2>

//           <div className="mb-6">
//             <p className="mb-6 text-muted-foreground">{letterDate}</p>
//             <div className="font-bold text-foreground">
//               <p>{recipientName}</p>
//               <p>{recipientAddress1}</p>
//               <p>{recipientAddress2}</p>
//             </div>
//           </div>

//           <p className="mb-4 font-bold text-foreground">
//             Re: Account Ending in {accountLastFour}
//           </p>

//           <div className="space-y-4 text-sm leading-relaxed text-foreground">
//             <p>Dear {salutationName},</p>
//             <p className="text-justify">
//               We are pleased to provide the payoff information for your account.
//               Please use the details below to remit the payoff amount. Payments
//               received after the good through date may require a new payoff.
//             </p>
//           </div>

//           <div className="my-8 rounded-xl border border-sky-100 bg-sky-50/80 p-6 dark:border-sky-500/25 dark:bg-sky-950/35">
//             <div className="grid grid-cols-1 gap-4">
//               <div className="flex items-center gap-4">
//                 <div className="shrink-0 rounded-full bg-blue-700 p-2 text-white dark:bg-primary dark:text-primary-foreground">
//                   <Hash size={18} />
//                 </div>
//                 <span className="w-44 shrink-0 font-semibold text-blue-900 dark:text-sky-300">
//                   Account Number
//                 </span>
//                 <span className="font-medium text-foreground">: {accountNumberFull}</span>
//               </div>
//               <div className="flex items-center gap-4">
//                 <div className="shrink-0 rounded-full bg-blue-700 p-2 text-white dark:bg-primary dark:text-primary-foreground">
//                   <DollarSign size={18} />
//                 </div>
//                 <span className="w-44 shrink-0 font-semibold text-blue-900 dark:text-sky-300">
//                   Payoff Amount
//                 </span>
//                 <span className="font-medium text-foreground">: {payoffAmount}</span>
//               </div>
//               <div className="flex items-center gap-4">
//                 <div className="shrink-0 rounded-full bg-blue-700 p-2 text-white dark:bg-primary dark:text-primary-foreground">
//                   <Calendar size={18} />
//                 </div>
//                 <span className="w-44 shrink-0 font-semibold text-blue-900 dark:text-sky-300">
//                   Good Through Date
//                 </span>
//                 <span className="font-medium text-foreground">: {goodThroughDate}</span>
//               </div>
//               <div className="flex items-center gap-4">
//                 <div className="shrink-0 rounded-full bg-blue-700 p-2 text-white dark:bg-primary dark:text-primary-foreground">
//                   <Info size={18} />
//                 </div>
//                 <span className="w-44 shrink-0 font-semibold text-blue-900 dark:text-sky-300">
//                   Note
//                 </span>
//                 <span className="font-medium text-xs text-foreground">
//                   : *Payoff amount is valid through the above date.
//                 </span>
//               </div>
//             </div>
//           </div>

//           <p className="mb-8 text-sm leading-relaxed text-foreground">
//             Please remit the payoff amount to the address below. Ensure payments
//             are received by the good through date to avoid additional interest
//             charges.
//           </p>

//           <div className="mb-12 flex items-start gap-4">
//             <div className="shrink-0 rounded-full bg-blue-700 p-3 text-white dark:bg-primary dark:text-primary-foreground">
//               <Mail size={24} />
//             </div>
//             <div className="text-sm text-foreground">
//               <p className="font-bold">Payment Address</p>
//               <p className="text-muted-foreground">{paymentCompany}</p>
//               <p className="text-muted-foreground">{paymentAddress1}</p>
//               <p className="text-muted-foreground">{paymentAddress2}</p>
//             </div>
//           </div>

//           <div className="relative mt-10">
//             <p className="mb-2 text-sm text-muted-foreground">Sincerely,</p>
//             <p className="text-sm font-bold text-foreground">{senderName}</p>
//             <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
//               {PAY_OFF_LETTER_SIGNATURE_TITLE}
//             </p>
//           </div>
//         </div>
//       </div>

//       <div className="relative flex flex-wrap items-center justify-around gap-y-2 bg-[#3F84D5] p-4 text-xs text-primary-foreground dark:bg-primary">
//         <div className="absolute top-0 bottom-0 left-0 w-12 -translate-x-6 skew-x-[-25deg] bg-[#D8E6F5] dark:bg-white/20" />
//         <div className="ml-8 flex items-center gap-2">
//           <Phone size={14} className="shrink-0" />
//           <span>845 - 746 - 0856</span>
//         </div>
//         <div className="flex items-center gap-2">
//           <Mail size={14} className="shrink-0" />
//           <span>jorden@barclaysadvance.com</span>
//         </div>
//         <div className="flex items-center gap-2">
//           <Globe size={14} className="shrink-0" />
//           <span>www.barclaysadvance.com</span>
//         </div>
//       </div>
//     </div>
//   );
// }
