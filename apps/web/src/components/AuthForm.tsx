import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthFormData } from "@/db/types";

interface AuthFormProps {
  type: "login" | "register" | "forgot-password" | "reset-password";
  onSubmit: (data: AuthFormData) => void;
  isLoading: boolean;
  error: string;
  success?: boolean;
  showToken?: boolean;
}

// Form field configuration
const getFormConfig = (type: AuthFormProps["type"]) => {
  const configs = {
    login: {
      title: "Welcome back",
      submitText: "Sign in",
      fields: ["email", "password"],
      links: [
        { to: "/register", text: "Don't have an account? Sign up" },
        { to: "/forgot-password", text: "Forgot your password?" },
      ],
    },
    register: {
      title: "Create account",
      submitText: "Sign up",
      fields: ["email", "password", "confirmPassword"],
      links: [{ to: "/login", text: "Already have an account? Sign in" }],
    },
    "forgot-password": {
      title: "Reset password",
      submitText: "Send reset email",
      fields: ["email"],
      links: [{ to: "/login", text: "Back to sign in" }],
    },
    "reset-password": {
      title: "Set new password",
      submitText: "Update password",
      fields: ["password", "confirmPassword"],
      links: [{ to: "/login", text: "Back to sign in" }],
    },
  };
  return configs[type];
};

// Field component
const FormField = ({
  name,
  value,
  onChange,
  disabled,
}: {
  name: keyof AuthFormData;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) => {
  const fieldConfig = {
    email: { type: "email", label: "Email", placeholder: "Enter your email" },
    password: {
      type: "password",
      label: "Password",
      placeholder: "Enter your password",
    },
    confirmPassword: {
      type: "password",
      label: "Confirm Password",
      placeholder: "Confirm your password",
    },
    name: { type: "text", label: "Name", placeholder: "Enter your name" },
  };

  const config = fieldConfig[name];

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{config.label}</Label>
      <Input
        id={name}
        type={config.type}
        placeholder={config.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
};

export const AuthForm = ({
  type,
  onSubmit,
  isLoading,
  error,
  success,
  showToken,
}: AuthFormProps) => {
  const [formData, setFormData] = useState<AuthFormData>({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
  });

  const config = getFormConfig(type);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const updateField = (field: keyof AuthFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Success state for forgot password
  if (type === "forgot-password" && success) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We've sent a password reset link to your email address.
          </p>
          <Link to="/login" className="block">
            <Button variant="outline" className="w-full">
              Back to sign in
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{config.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Render form fields based on type */}
          {config.fields.map((field) => (
            <FormField
              key={field}
              name={field as keyof AuthFormData}
              value={formData[field as keyof AuthFormData] || ""}
              onChange={(value) =>
                updateField(field as keyof AuthFormData, value)
              }
              disabled={isLoading}
            />
          ))}

          {/* Error display */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}

          {/* Token warning for reset password */}
          {showToken && !showToken && (
            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-md">
              Invalid or missing reset token. Please request a new password
              reset.
            </div>
          )}

          {/* Submit button */}
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Loading..." : config.submitText}
          </Button>

          {/* Navigation links */}
          <div className="space-y-2 text-center">
            {config.links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="block text-sm text-muted-foreground hover:text-foreground"
              >
                {link.text}
              </Link>
            ))}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
