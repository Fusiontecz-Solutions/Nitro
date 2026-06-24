import { useEffect } from 'react';
import { useForm, Controller, type SubmitHandler } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createUser } from '@/redux/actions/settingsUserActions';
import type { AppDispatch } from '@/redux/store';
import { formatUSPhoneNumber, handleUSPhoneInputChange } from '@/utils/formatPhoneNumber';

interface FormValues {
  name: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  status: 'active' | 'inactive';
}

const schema = yup.object().shape({
  name: yup.string().trim().required('First name is required'),
  lastName: yup.string().trim().required('Last name is required'),
  email: yup.string().email('Invalid email').required('Email is required'),
  phone: yup.string().trim().optional(),
  password: yup
    .string()
    .required('Password is required')
    .min(8, 'Password must be at least 8 characters')
    .matches(/[A-Z]/, 'Password must include an uppercase letter')
    .matches(/[a-z]/, 'Password must include a lowercase letter')
    .matches(/[0-9]/, 'Password must include a number')
    .matches(/[^A-Za-z0-9]/, 'Password must include a special character'),
  status: yup.string().oneOf(['active', 'inactive']).default('active'),
});

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  /** Role id (e.g. AGENT, UNDERWRITER). Used for API and Redux byRole. */
  role: string;
  /** Display name for the role (e.g. "Agent", "Underwriter"). */
  roleName?: string;
  onSuccess?: () => void;
  /** When true, request includes `createSyndicatorProfile: true` on create-user (optional; syndicator profiles are created by default). */
  createSyndicatorProfile?: boolean;
}

export default function AddUserModal({
  open,
  onClose,
  role,
  roleName,
  onSuccess,
  createSyndicatorProfile,
}: AddUserModalProps) {
  const dispatch = useDispatch<AppDispatch>();

  const {
    control,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema) as any,
    defaultValues: {
      name: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      status: 'active',
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      status: 'active',
    });
  }, [open, reset]);

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    try {
      const fullName = `${data.name} ${data.lastName}`.trim();
      await dispatch(
        createUser({
          name: fullName,
          email: data.email.trim().toLowerCase(),
          phone: data.phone?.trim() || undefined,
          password: data.password,
          role,
          status: data.status === 'active',
          ...(createSyndicatorProfile ? { createSyndicatorProfile: true } : {}),
        })
      ).unwrap();
      toast.success(
        createSyndicatorProfile
          ? 'Syndicator account and profile created'
          : 'User created successfully',
      );
      onClose();
      onSuccess?.();
    } catch (err: any) {
      const message =
        typeof err === 'string' ? err : err?.message ?? 'Failed to create user';
      toast.error(message);
    }
  };

  const label = roleName ?? role;

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {label}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">First Name</Label>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <Input
                  id="name"
                  placeholder="Enter first name"
                  autoComplete="name"
                  disabled={isSubmitting}
                  {...field}
                />
              )}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Controller
              name="lastName"
              control={control}
              render={({ field }) => (
                <Input
                  id="lastName"
                  placeholder="Enter last name"
                  autoComplete="family-name"
                  disabled={isSubmitting}
                  {...field}
                />
              )}
            />
            {errors.lastName && (
              <p className="text-sm text-destructive">{errors.lastName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Controller
              name="email"
              control={control}
              render={({ field }) => (
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter email"
                  autoComplete="email"
                  disabled={isSubmitting}
                  {...field}
                />
              )}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Controller
              name="phone"
              control={control}
              render={({ field }) => (
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(XXX) XXX-XXXX"
                  autoComplete="tel"
                  disabled={isSubmitting}
                  {...field}
                  value={formatUSPhoneNumber(field.value)}
                  onChange={(e) => handleUSPhoneInputChange(e, field.onChange)}
                  inputMode="numeric"
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Controller
              name="password"
              control={control}
              render={({ field }) => (
                <Input
                  id="password"
                  type="password"
                  placeholder="Min 8 chars, upper, lower, number, symbol"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                  {...field}
                />
              )}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          {/* <div className="space-y-2">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div> */}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
