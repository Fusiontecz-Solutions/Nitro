import { useEffect, useMemo } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
// import { Loader2 } from 'lucide-react'; // Optional: for icons

import type { RootState, AppDispatch } from '@/redux/store';
import { updateUser } from '@/redux/actions/settingsUserActions';
import type { user as User } from '@/redux/slices/authSlice';
import { TextField, EmailField, PhoneField } from '@/components/inputFields/InputFields';
// import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

// Assuming you have these standard Shadcn-like components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface FormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

const schema = yup.object().shape({
  firstName: yup.string().trim().required('First name is required'),
  lastName: yup.string().trim().required('Last name is required'),
  email: yup.string().email('Invalid email').required('Email is required'),
  phone: yup.string().trim().optional(),
});

export default function UserSetting() {
  const dispatch = useDispatch<AppDispatch>();
  const loginData = useSelector((state: RootState) => state.login?.data);
  const isFieldsDisabled = true;

  const user: User | undefined = useMemo(() => {
    if (loginData?.user) return loginData.user;
    try {
      const stored = localStorage.getItem('user');
      return stored ? (JSON.parse(stored) as User) : undefined;
    } catch {
      return undefined;
    }
  }, [loginData]);

  const initials = useMemo(() => {
    const first = user?.firstName?.trim()?.[0] ?? '';
    const last = user?.lastName?.trim()?.[0] ?? '';
    const combined = `${first}${last}`.toUpperCase();
    return combined || (user?.email?.[0]?.toUpperCase() ?? 'U');
  }, [user]);

  const {
    control,
    handleSubmit,
    reset,
    // formState: { isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: yupResolver(schema) as any,
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
    },
  });

  useEffect(() => {
    if (!user) return;
    reset({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      email: user.email ?? '',
      phone: user.phone ?? '',
    });
  }, [user, reset]);

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    if (!user?._id) {
      toast.error('Unable to update profile. User not found.');
      return;
    }

    try {
      const payload = {
        id: user._id,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email: values.email.trim().toLowerCase(),
        phone: values.phone?.trim() || undefined,
      };

      const res: any = await dispatch(updateUser(payload)).unwrap();

      const updatedUser: User = {
        ...user,
        ...payload,
      };

      localStorage.setItem('user', JSON.stringify(updatedUser));
      toast.success(res?.message ?? 'Account settings updated successfully');
      reset(values);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update account settings');
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] w-full bg-background">
      <div className="container w-full px-4 py-10">
        <div className="flex flex-col gap-6">
          {/* Header Section */}
          <div className="flex flex-col gap-2">
            
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">Settings</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Manage your profile information and keep your contact details up to date.
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
            {/* Sidebar / Context info */}
            <aside className="md:self-start">
              <Card className="border-border">
                <CardContent className="pt-6 flex flex-col items-center md:items-center gap-4">
                  <div className="relative flex items-center justify-center">
                    <div className="h-24 w-24 rounded-full flex items-center justify-center border border-border/70 shadow-sm text-3xl font-semibold text-white bg-[#276D9C]">
                      {initials}
                    </div>
                    {/* <span className="absolute -bottom-1 -right-1 inline-flex items-center rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-medium text-emerald-950 shadow-sm">
                      Active
                    </span> */}
                  </div>

                  <div className="text-center md:text-center space-y-1 mt-4">
                    <h3 className="text-base font-semibold leading-tight">
                      {user?.firstName} {user?.lastName}
                    </h3>
                    <p className="text-xs text-muted-foreground break-all">{user?.email}</p>
                  </div>

                  {/* <div className="w-full space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between rounded-md border border-dashed border-border/70 bg-background/60 px-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-medium text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
                          Profile completeness
                        </span>
                        <span className="text-[11px]">
                          Keep your details current for smoother client communication.
                        </span>
                      </div>
                    </div>
                  </div> */}
                </CardContent>
              </Card>
            </aside>

            {/* Form Card */}
            <Card className="border-border md:col-span-1">
              <CardHeader className="border-b bg-muted/40 backdrop-blur-sm">
                <CardTitle className="text-lg">Personal information</CardTitle>
                <CardDescription>
                  These details are used across your In‑House CRM workspace.
                </CardDescription>
              </CardHeader>

              <form onSubmit={handleSubmit(onSubmit)}>
                <CardContent className="space-y-6 pt-6">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TextField
                      name="firstName"
                      label="First Name"
                      required
                      disabled={isFieldsDisabled}
                      control={control}
                    />
                    <TextField
                      name="lastName"
                      label="Last Name"
                      required
                      disabled={isFieldsDisabled}
                      control={control}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <EmailField
                      name="email"
                      label="Email Address"
                      required
                      disabled={isFieldsDisabled}
                      control={control}
                    />
                    <PhoneField
                      name="phone"
                      label="Phone Number"
                      disabled={isFieldsDisabled}
                      control={control}
                    />
                  </div>
                </CardContent>

                {/* <CardFooter className="flex flex-col gap-3 border-t bg-muted/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11px] text-muted-foreground">
                    Changes apply immediately to your active sessions.
                  </p>
                  <div className="flex w-full justify-end gap-2 sm:w-auto">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => reset()}
                      disabled={isSubmitting || !isDirty}
                    >
                      Reset
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting || !isDirty}
                      className="min-w-[130px] shadow-xs hover:shadow-sm transition-shadow"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving
                        </>
                      ) : (
                        'Save changes'
                      )}
                    </Button>
                  </div>
                </CardFooter> */}
              </form>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}