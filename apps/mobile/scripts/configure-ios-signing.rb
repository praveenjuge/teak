# frozen_string_literal: true

require "xcodeproj"

project_path = ARGV.fetch(0)
version = ENV.fetch("TEAK_IOS_VERSION")
build_number = ENV.fetch("TEAK_IOS_BUILD_NUMBER")
team_id = ENV.fetch("APPLE_TEAM_ID")
identity = ENV.fetch("APPLE_DISTRIBUTION_IDENTITY")

unless version.match?(/\A(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\z/)
  abort "TEAK_IOS_VERSION must be a stable three-component version."
end
unless build_number.match?(/\A[1-9]\d*\z/)
  abort "TEAK_IOS_BUILD_NUMBER must be a positive integer."
end

targets = {
  "Teak" => {
    bundle_id: "com.praveenjuge.teak",
    profile: ENV.fetch("IOS_APP_PROFILE_NAME"),
  },
  "expo-sharing-extension" => {
    bundle_id: "com.praveenjuge.teak.share-extension",
    profile: ENV.fetch("IOS_EXTENSION_PROFILE_NAME"),
  },
}

project = Xcodeproj::Project.open(project_path)
targets.each do |target_name, expected|
  target = project.targets.find { |candidate| candidate.name == target_name }
  abort "Missing generated Xcode target #{target_name}." unless target

  target.build_configurations.each do |configuration|
    settings = configuration.build_settings
    actual_bundle_id = settings.fetch("PRODUCT_BUNDLE_IDENTIFIER", "").delete('"')
    unless actual_bundle_id == expected.fetch(:bundle_id)
      abort "#{target_name} bundle ID is #{actual_bundle_id}, expected #{expected.fetch(:bundle_id)}."
    end

    settings["CODE_SIGN_IDENTITY"] = identity
    settings["CODE_SIGN_IDENTITY[sdk=iphoneos*]"] = identity
    settings["CODE_SIGN_STYLE"] = "Manual"
    settings["CURRENT_PROJECT_VERSION"] = build_number
    settings["DEVELOPMENT_TEAM"] = team_id
    settings["MARKETING_VERSION"] = version
    settings["PROVISIONING_PROFILE_SPECIFIER"] = expected.fetch(:profile)
    settings["PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]"] = expected.fetch(:profile)
  end
end

project.save
puts "Configured Teak iOS signing for #{version} (#{build_number})."
