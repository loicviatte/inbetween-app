require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AudioRoutePicker'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = { :type => 'MIT' }
  s.author         = { 'loicviatte' => '' }
  s.homepage       = 'https://github.com/loicviatte/inbetween-app'
  s.platform       = :ios, '15.1'
  s.swift_version  = '5.4'
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
end
