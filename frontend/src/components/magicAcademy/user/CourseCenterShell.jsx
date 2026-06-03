import MagicAcademyBreadcrumb from "../shared/MagicAcademyBreadcrumb";

export default function CourseCenterShell({
  title,
  subtitle,
  backText,
  onBack,
  children,
}) {
  return (
    <>
      <MagicAcademyBreadcrumb
        title={title}
        subtitle={subtitle}
        backText={backText}
        onBack={onBack}
      />
      {children}
    </>
  );
}
